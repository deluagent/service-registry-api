/**
 * ServiceRegistry Monitor
 *
 * Autonomous health monitor that runs every 30 minutes:
 *   1. Fetches all registered services
 *   2. Calls each service's health endpoint
 *   3. Checks response time + validity
 *   4. Submits onchain ratings via ServiceRegistry.rateService()
 *   5. Logs protocol-level stats
 *
 * This is the flywheel. Bad services get rated down → eventually slashed.
 * Good services get rated up → more traffic. The registry self-governs.
 */

import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const DEPLOY_KEY       = process.env.DEPLOY_KEY || '0xfc50210a7ffa2fcbe1ca40ef5bb5374120960c16ad318aef4151bd7eb404e44c';
const SERVICE_REGISTRY = '0xc6922DD8681B3d57A2955a5951E649EF38Ea1192';
const RPC              = 'https://mainnet.base.org';
const INTERVAL_MS      = 30 * 60 * 1000; // 30 min

const account = privateKeyToAccount(DEPLOY_KEY);

const publicClient = createPublicClient({ chain: base, transport: http(RPC) });
const walletClient = createWalletClient({ chain: base, transport: http(RPC), account });

const REGISTRY_ABI = [
  {
    type: 'function', name: 'serviceCount', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'getService', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'owner',           type: 'address' },
        { name: 'name',            type: 'string'  },
        { name: 'capabilitiesURI', type: 'string'  },
        { name: 'pricePerCallWei', type: 'uint256' },
        { name: 'category',        type: 'uint8'   },
        { name: 'stakedETH',       type: 'uint256' },
        { name: 'reputationScore', type: 'uint256' },
        { name: 'totalCalls',      type: 'uint256' },
        { name: 'goodResponses',   type: 'uint256' },
        { name: 'badResponses',    type: 'uint256' },
        { name: 'registeredAt',    type: 'uint256' },
        { name: 'active',          type: 'bool'    },
        { name: 'slashed',         type: 'bool'    },
      ],
    }],
  },
  {
    type: 'function', name: 'rateService', stateMutability: 'nonpayable',
    inputs: [
      { name: 'serviceId', type: 'uint256' },
      { name: 'score',     type: 'uint8'   },
      { name: 'comment',   type: 'string'  },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'treasuryBalance', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
];

// Known service health endpoints (by name)
const HEALTH_ENDPOINTS = {
  'delu':              'http://localhost:3456/health',
  'ReputationOracle':  'http://localhost:4003/health',
  'VeniceProxy':       'http://localhost:4010/health',
  'PriceOracle':       'http://localhost:4020/health',
};

async function checkService(id, svc) {
  const endpoint = HEALTH_ENDPOINTS[svc.name];
  if (!endpoint) {
    console.log(`  [${svc.name}] no health endpoint configured — skip`);
    return null;
  }

  const start = Date.now();
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    const ms = Date.now() - start;
    const data = await res.json();

    const healthy = res.ok && data;
    const score = healthy
      ? (ms < 500 ? 5 : ms < 2000 ? 4 : 3)
      : 2;

    console.log(`  [${svc.name}] ${healthy ? '✓' : '✗'} ${ms}ms → score=${score}`);
    return { score, comment: `health check: ${healthy ? 'ok' : 'failed'} ${ms}ms`, healthy };
  } catch (e) {
    console.log(`  [${svc.name}] ✗ unreachable: ${e.message}`);
    return { score: 1, comment: `unreachable: ${e.message}`, healthy: false };
  }
}

async function getProtocolStats() {
  const count = await publicClient.readContract({
    address: SERVICE_REGISTRY, abi: REGISTRY_ABI, functionName: 'serviceCount',
  });
  const treasury = await publicClient.readContract({
    address: SERVICE_REGISTRY, abi: REGISTRY_ABI, functionName: 'treasuryBalance',
  });

  const services = [];
  let totalStaked = 0n;
  let totalCalls = 0n;
  let activeCount = 0;

  for (let i = 0n; i < count; i++) {
    const svc = await publicClient.readContract({
      address: SERVICE_REGISTRY, abi: REGISTRY_ABI, functionName: 'getService', args: [i],
    });
    services.push({ id: Number(i), ...svc });
    totalStaked += svc.stakedETH;
    totalCalls += svc.totalCalls;
    if (svc.active) activeCount++;
  }

  return {
    totalServices: Number(count),
    activeServices: activeCount,
    totalStakedETH: formatEther(totalStaked),
    totalStakedUSD: (parseFloat(formatEther(totalStaked)) * 2150).toFixed(2),
    totalCalls: Number(totalCalls),
    treasuryETH: formatEther(treasury),
    services,
  };
}

async function runMonitorCycle() {
  const ts = new Date().toISOString();
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`  Monitor cycle — ${ts}`);
  console.log(`  Agent: ${account.address}`);
  console.log('─'.repeat(55));

  // Protocol stats
  const stats = await getProtocolStats();
  console.log(`\n  Protocol:`);
  console.log(`  Services:   ${stats.activeServices}/${stats.totalServices} active`);
  console.log(`  TVL:        ${stats.totalStakedETH} ETH (~$${stats.totalStakedUSD})`);
  console.log(`  Total calls: ${stats.totalCalls}`);
  console.log(`  Treasury:   ${stats.treasuryETH} ETH`);

  // Check balance — need ETH for gas to rate
  const balance = await publicClient.getBalance({ address: account.address });
  const hasGas = balance > 50_000_000_000_000n; // > 0.00005 ETH
  console.log(`  Monitor bal: ${formatEther(balance)} ETH ${hasGas ? '(can rate)' : '(no gas — skip onchain rating)'}`);

  console.log(`\n  Health checks:`);

  for (const svc of stats.services) {
    if (!svc.active) continue;
    const result = await checkService(svc.id, svc);
    if (!result) continue;

    // Submit onchain rating if we have gas
    if (hasGas) {
      try {
        const hash = await walletClient.writeContract({
          address: SERVICE_REGISTRY,
          abi: REGISTRY_ABI,
          functionName: 'rateService',
          args: [BigInt(svc.id), result.score, result.comment],
        });
        console.log(`    → rated onchain: ${hash.slice(0,18)}...`);
      } catch (e) {
        // 24h rate limit — expected
        if (e.message?.includes('RateLimited') || e.message?.includes('rate')) {
          console.log(`    → rate limited (24h cooldown)`);
        } else {
          console.log(`    → rating failed: ${e.message?.slice(0,60)}`);
        }
      }
    }
  }

  console.log(`\n  ✓ cycle complete\n`);
  return stats;
}

// Cache — serve stale stats rather than hammer RPC
let cachedStats = null;
let cacheTime = 0;
const STATS_TTL = 60_000; // 1 min

async function getProtocolStatsCached() {
  if (cachedStats && Date.now() - cacheTime < STATS_TTL) return cachedStats;
  cachedStats = await getProtocolStats();
  cacheTime = Date.now();
  return cachedStats;
}

// Export for use in API
export { getProtocolStats, getProtocolStatsCached, runMonitorCycle };

// Run immediately + on interval if called directly
if (process.argv[1].includes('monitor')) {
  runMonitorCycle().catch(console.error);
  setInterval(() => runMonitorCycle().catch(console.error), INTERVAL_MS);
  console.log(`Monitor started — cycling every ${INTERVAL_MS / 60000} minutes`);
}
