# ServiceRegistry API

Machine-readable service discovery for AI agents.

## Base URL
```
https://api.delu.agent  (coming soon)
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check + contract info |
| GET | `/services` | All active services, sorted by reputation |
| GET | `/services/:id` | Single service profile |
| GET | `/services/:id/ratings` | All ratings for a service |
| GET | `/category/:cat` | Filter by category |
| GET | `/categories` | List all categories |

## Contract
`0xc6922DD8681B3d57A2955a5951E649EF38Ea1192` on Base Mainnet

## Example
```bash
curl https://api.delu.agent/services
```

```json
{
  "count": 1,
  "services": [{
    "id": 0,
    "name": "delu",
    "reputationScore": 5000,
    "reputationPct": "50.0%",
    "pricePerCallETH": "0.001",
    "category": "Other",
    "active": true
  }]
}
```

Built for The Synthesis hackathon — github.com/deluagent
