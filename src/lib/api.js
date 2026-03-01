const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.fintraxa.com';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ─── MUFAP Mutual Funds ─────────────────────────
export const mufapAPI = {
  getFunds: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return fetchJSON(`${API_BASE}/api/mufap/funds${q ? `?${q}` : ''}`);
  },
  searchFunds: (query, field = 'fund_name') =>
    fetchJSON(`${API_BASE}/api/mufap/funds/search?q=${encodeURIComponent(query)}&field=${field}`),
  getCategories: () =>
    fetchJSON(`${API_BASE}/api/mufap/funds/categories`),
  getFundsByCategory: (category) =>
    fetchJSON(`${API_BASE}/api/mufap/funds/category/${encodeURIComponent(category)}`),
  getTopNav: (limit = 10) =>
    fetchJSON(`${API_BASE}/api/mufap/funds/top-nav?limit=${limit}`),
  getStats: () =>
    fetchJSON(`${API_BASE}/api/mufap/funds/stats`),
  getHealth: () =>
    fetchJSON(`${API_BASE}/api/mufap/health`),
};

// ─── PSX Stocks ─────────────────────────────────
export const psxAPI = {
  getStocks: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return fetchJSON(`${API_BASE}/api/psx/stocks${q ? `?${q}` : ''}`);
  },
  searchStocks: (symbol) =>
    fetchJSON(`${API_BASE}/api/psx/stocks/search?symbol=${encodeURIComponent(symbol)}`),
  getStock: (symbol) =>
    fetchJSON(`${API_BASE}/api/psx/stocks/${encodeURIComponent(symbol)}`),
  getGainers: (limit = 20) =>
    fetchJSON(`${API_BASE}/api/psx/stocks/gainers?limit=${limit}`),
  getLosers: (limit = 20) =>
    fetchJSON(`${API_BASE}/api/psx/stocks/losers?limit=${limit}`),
  getActive: (limit = 20) =>
    fetchJSON(`${API_BASE}/api/psx/stocks/active?limit=${limit}`),
  getSummary: () =>
    fetchJSON(`${API_BASE}/api/psx/stocks/summary`),
  getIndices: () =>
    fetchJSON(`${API_BASE}/api/psx/indices`),
  getHealth: () =>
    fetchJSON(`${API_BASE}/api/psx/health`),
  scrape: async () => {
    const res = await fetch(`${API_BASE}/api/psx/scrape`, { method: 'POST' });
    if (!res.ok) throw new Error(`Scrape failed: ${res.status}`);
    return res.json();
  },
};

// ─── Health Check ───────────────────────────────
export const getAPIHealth = () => fetchJSON(`${API_BASE}/api/health`);
