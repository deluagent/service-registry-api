export const SERVICE_REGISTRY_ABI = [
  // register
  {
    "type": "function", "name": "register", "stateMutability": "payable",
    "inputs": [
      {"name": "name", "type": "string"},
      {"name": "capabilitiesURI", "type": "string"},
      {"name": "pricePerCallWei", "type": "uint256"},
      {"name": "category", "type": "uint8"}
    ],
    "outputs": [{"name": "id", "type": "uint256"}]
  },
  // getService
  {
    "type": "function", "name": "getService", "stateMutability": "view",
    "inputs": [{"name": "id", "type": "uint256"}],
    "outputs": [{
      "type": "tuple",
      "components": [
        {"name": "owner", "type": "address"},
        {"name": "name", "type": "string"},
        {"name": "capabilitiesURI", "type": "string"},
        {"name": "pricePerCallWei", "type": "uint256"},
        {"name": "category", "type": "uint8"},
        {"name": "stakedETH", "type": "uint256"},
        {"name": "reputationScore", "type": "uint256"},
        {"name": "totalCalls", "type": "uint256"},
        {"name": "goodResponses", "type": "uint256"},
        {"name": "badResponses", "type": "uint256"},
        {"name": "registeredAt", "type": "uint256"},
        {"name": "active", "type": "bool"},
        {"name": "slashed", "type": "bool"}
      ]
    }]
  },
  // serviceCount
  {
    "type": "function", "name": "serviceCount", "stateMutability": "view",
    "inputs": [], "outputs": [{"type": "uint256"}]
  },
  // getServicesByCategory
  {
    "type": "function", "name": "getServicesByCategory", "stateMutability": "view",
    "inputs": [
      {"name": "category", "type": "uint8"},
      {"name": "offset", "type": "uint256"},
      {"name": "limit", "type": "uint256"}
    ],
    "outputs": [
      {"name": "ids", "type": "uint256[]"},
      {"name": "total", "type": "uint256"}
    ]
  },
  // getRatings
  {
    "type": "function", "name": "getRatings", "stateMutability": "view",
    "inputs": [{"name": "id", "type": "uint256"}],
    "outputs": [{
      "type": "tuple[]",
      "components": [
        {"name": "rater", "type": "address"},
        {"name": "serviceId", "type": "uint256"},
        {"name": "score", "type": "uint8"},
        {"name": "evidenceURI", "type": "string"},
        {"name": "timestamp", "type": "uint256"}
      ]
    }]
  },
  // rateService
  {
    "type": "function", "name": "rateService", "stateMutability": "nonpayable",
    "inputs": [
      {"name": "id", "type": "uint256"},
      {"name": "score", "type": "uint8"},
      {"name": "evidenceURI", "type": "string"}
    ],
    "outputs": []
  },
  // events
  {
    "type": "event", "name": "ServiceRegistered",
    "inputs": [
      {"name": "id", "type": "uint256", "indexed": true},
      {"name": "owner", "type": "address", "indexed": true},
      {"name": "name", "type": "string", "indexed": false},
      {"name": "category", "type": "uint8", "indexed": false}
    ]
  }
];

export const CATEGORIES = ['Data', 'Compute', 'Storage', 'Oracle', 'Identity', 'Other'];
