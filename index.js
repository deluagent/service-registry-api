import express from 'express';
import { createPublicClient, http, formatEther } from 'viem';
import { base } from 'viem/chains';
import { SERVICE_REGISTRY_ABI, CATEGORIES } from './abi.js';

const CONTRACT = '0xc6922DD8681B3d57A2955a5951E649EF38Ea1192';

const client = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
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

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ServiceRegistry API running on :${PORT}`);
  console.log(`Contract: ${CONTRACT}`);
  console.log(`Chain: Base Mainnet (8453)`);
});
