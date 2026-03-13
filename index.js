import express from 'express';
import { createPublicClient, http, formatEther, isAddress } from 'viem';
import { base } from 'viem/chains';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import { SERVICE_REGISTRY_ABI, CATEGORIES } from './abi.js';
import { getProtocolStatsCached, runMonitorCycle } from './monitor.js';

const CONTRACT = '0xc6922DD8681B3d57A2955a5951E649EF38Ea1192';

const client = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
});

// Mainnet client for ENS (ENS is on Ethereum L1)
const ensClient = createPublicClient({
  chain: mainnet,
  transport: http('https://ethereum-rpc.publicnode.com'),
});

const app = express();
app.use(express.json());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatService(id, svc) {
  return {
    id: Number(id),
    owner: svc.owner,
    name: svc.name,
    capabilitiesURI: svc.capabilitiesURI,
    pricePerCallWei: svc.pricePerCallWei.toString(),
    pricePerCallETH: formatEther(svc.pricePerCallWei),
    category: CATEGORIES[svc.category] ?? 'Other',
    categoryId: svc.category,
    stakedETH: formatEther(svc.stakedETH),
    reputationScore: Number(svc.reputationScore),
    reputationPct: (Number(svc.reputationScore) / 100).toFixed(1) + '%',
    totalCalls: Number(svc.totalCalls),
    goodResponses: Number(svc.goodResponses),
    badResponses: Number(svc.badResponses),
    registeredAt: Number(svc.registeredAt),
    active: svc.active,
    slashed: svc.slashed,
  };
}

async function fetchService(id) {
  const svc = await client.readContract({
    address: CONTRACT,
    abi: SERVICE_REGISTRY_ABI,
    functionName: 'getService',
    args: [BigInt(id)],
  });
  return formatService(id, svc);
}

async function getAllServices() {
  const count = await client.readContract({
    address: CONTRACT,
    abi: SERVICE_REGISTRY_ABI,
    functionName: 'serviceCount',
  });

  const ids = Array.from({ length: Number(count) }, (_, i) => i);
  const services = await Promise.all(ids.map(fetchService));
  return services.filter(s => s.active);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    contract: CONTRACT,
    chain: 'base',
    chainId: 8453,
    timestamp: Date.now(),
  });
});

// GET /services — all active services, sorted by reputation
app.get('/services', async (req, res) => {
  try {
    const services = await getAllServices();
    const sorted = services.sort((a, b) => b.reputationScore - a.reputationScore);
    res.json({
      count: sorted.length,
      contract: CONTRACT,
      services: sorted,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /services/:id — single service profile
app.get('/services/:id', async (req, res) => {
  try {
    const svc = await fetchService(Number(req.params.id));
    res.json(svc);
  } catch (e) {
    res.status(404).json({ error: 'service not found' });
  }
});

// GET /services/:id/ratings — all ratings for a service
app.get('/services/:id/ratings', async (req, res) => {
  try {
    const ratings = await client.readContract({
      address: CONTRACT,
      abi: SERVICE_REGISTRY_ABI,
      functionName: 'getRatings',
      args: [BigInt(req.params.id)],
    });
    res.json({
      serviceId: Number(req.params.id),
      count: ratings.length,
      ratings: ratings.map(r => ({
        rater: r.rater,
        score: r.score,
        evidenceURI: r.evidenceURI,
        timestamp: Number(r.timestamp),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /services/category/:cat — filter by category name
app.get('/category/:cat', async (req, res) => {
  try {
    const catId = CATEGORIES.findIndex(
      c => c.toLowerCase() === req.params.cat.toLowerCase()
    );
    if (catId === -1) return res.status(400).json({ error: 'unknown category', valid: CATEGORIES });

    const [ids, total] = await client.readContract({
      address: CONTRACT,
      abi: SERVICE_REGISTRY_ABI,
      functionName: 'getServicesByCategory',
      args: [catId, 0n, 100n],
    });

    const services = await Promise.all(ids.map(id => fetchService(Number(id))));
    const sorted = services.sort((a, b) => b.reputationScore - a.reputationScore);

    res.json({ category: CATEGORIES[catId], total: Number(total), services: sorted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /categories — list all categories
app.get('/categories', (req, res) => {
  res.json({ categories: CATEGORIES });
});

// GET /stats — protocol-level metrics (TVL, calls, treasury, reputation dist)
app.get('/stats', async (req, res) => {
  try {
    const stats = await getProtocolStatsCached();

    // Reputation distribution
    const repBuckets = { low: 0, medium: 0, high: 0, elite: 0 };
    for (const svc of stats.services) {
      const rep = Number(svc.reputationScore);
      if (rep >= 8000)      repBuckets.elite++;
      else if (rep >= 6000) repBuckets.high++;
      else if (rep >= 4000) repBuckets.medium++;
      else                  repBuckets.low++;
    }

    res.json({
      protocol: 'ServiceRegistry',
      contract: '0xc6922DD8681B3d57A2955a5951E649EF38Ea1192',
      chain: 'base',
      chainId: 8453,
      metrics: {
        totalServices:  stats.totalServices,
        activeServices: stats.activeServices,
        totalStakedETH: stats.totalStakedETH,
        totalStakedUSD: stats.totalStakedUSD,
        totalCalls:     stats.totalCalls,
        treasuryETH:    stats.treasuryETH,
      },
      reputationDistribution: repBuckets,
      topServices: stats.services
        .filter(s => s.active)
        .sort((a, b) => Number(b.reputationScore) - Number(a.reputationScore))
        .slice(0, 5)
        .map(s => ({
          id: s.id,
          name: s.name,
          reputationScore: Number(s.reputationScore),
          reputationPct: (Number(s.reputationScore) / 100).toFixed(1) + '%',
          totalCalls: Number(s.totalCalls),
          stakedETH: formatEther(s.stakedETH),
        })),
      timestamp: Date.now(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /ens/:name — resolve ENS name → find services owned by that address
app.get('/ens/:name', async (req, res) => {
  const ensName = req.params.name;

  // Validate it looks like an ENS name
  if (!ensName.includes('.')) {
    return res.status(400).json({ error: 'invalid ENS name — must contain a dot (e.g. delu.eth)' });
  }

  // Resolve ENS name → address on Ethereum mainnet
  let address;
  try {
    const normalized = normalize(ensName);
    address = await ensClient.getEnsAddress({ name: normalized });
  } catch (e) {
    return res.status(400).json({ error: `ENS normalization failed: ${e.message}` });
  }

  if (!address) {
    return res.status(404).json({
      ensName,
      address: null,
      services: [],
      message: `${ensName} is not registered in ENS or has no address record`,
    });
  }

  // Find services owned by this address in the ServiceRegistry on Base
  try {
    const allServices = await getAllServices();
    const ownedServices = allServices.filter(
      s => s.owner.toLowerCase() === address.toLowerCase()
    );

    // Optionally enrich: try to get the primary ENS name of the resolved address
    // (may differ from ensName if it's a subdomain or alias)
    let primaryName = null;
    try {
      primaryName = await ensClient.getEnsName({ address });
    } catch {
      // non-critical
    }

    res.json({
      ensName,
      primaryEnsName: primaryName,
      address,
      serviceCount: ownedServices.length,
      services: ownedServices,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /monitor/run — manually trigger a monitor cycle
app.post('/monitor/run', async (req, res) => {
  try {
    const stats = await runMonitorCycle();
    res.json({ success: true, stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ServiceRegistry API :${PORT}`);
  console.log(`Contract: ${CONTRACT}`);
  console.log(`Routes: /health /services /stats /monitor/run /categories /ens/:name`);

  // Run monitor cycle on boot, then every 30 min
  runMonitorCycle().catch(console.error);
  setInterval(() => runMonitorCycle().catch(console.error), 30 * 60 * 1000);
});
