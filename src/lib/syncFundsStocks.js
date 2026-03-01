/**
 * Sync funds and stocks from Fintraxa API to Supabase.
 * Only fetches when API last_scrape is newer than our stored value (updated values only).
 * Normalizes API responses into clean DB rows.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.fintraxa.com';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status} ${url}`);
  return res.json();
}

/** Get last_scrape from API (minimal request). */
async function getFundsLastScrape() {
  const r = await fetchJSON(`${API_BASE}/api/mufap/funds?limit=1`);
  return r.last_scrape || null;
}

async function getStocksLastScrape() {
  const r = await fetchJSON(`${API_BASE}/api/psx/stocks?limit=1`);
  return r.last_scrape || null;
}

/** Fetch all funds with pagination. */
async function fetchAllFunds() {
  const limit = 5000;
  const out = [];
  let offset = 0;
  let lastScrape = null;
  while (true) {
    const r = await fetchJSON(
      `${API_BASE}/api/mufap/funds?limit=${limit}&offset=${offset}&sort_by=fund_name&ascending=true`
    );
    lastScrape = r.last_scrape || lastScrape;
    const list = r.data || [];
    out.push(...list);
    if (list.length < limit) break;
    offset += limit;
  }
  return { data: out, last_scrape: lastScrape };
}

/** Fetch all stocks with pagination. */
async function fetchAllStocks() {
  const limit = 5000;
  const out = [];
  let offset = 0;
  let lastScrape = null;
  while (true) {
    const r = await fetchJSON(
      `${API_BASE}/api/psx/stocks?limit=${limit}&offset=${offset}&sort_by=volume&ascending=false`
    );
    lastScrape = r.last_scrape || lastScrape;
    const list = r.data || [];
    out.push(...list);
    if (list.length < limit) break;
    offset += limit;
  }
  return { data: out, last_scrape: lastScrape };
}

/** Map MUFAP fund row to our funds table shape. */
function mapFundToRow(f) {
  const nav = f.nav != null ? Number(f.nav) : 0;
  return {
    fund_name: f.fund_name ?? '',
    fund_category: f.fund_category ?? null,
    nav,
    trustee: f.trustee ?? null,
    offer_price: f.offer_price != null ? Number(f.offer_price) : null,
    repurchase_price: f.repurchase_price != null ? Number(f.repurchase_price) : null,
    date_updated: f.date_updated || null,
    scrape_timestamp: f.scrape_timestamp || null,
    updated_at: new Date().toISOString(),
  };
}

/** Map PSX stock row to our stocks table shape. */
function mapStockToRow(s) {
  const current = s.current != null ? Number(s.current) : (s.ldcp != null ? Number(s.ldcp) : 0);
  return {
    symbol: s.symbol ?? '',
    company_name: s.company_name ?? s.company ?? null,
    current_price: current,
    change_amount: s.change != null ? Number(s.change) : null,
    change_pct: s.change_pct != null ? Number(s.change_pct) : null,
    volume: s.volume != null ? Number(s.volume) : 0,
    open_price: s.open != null ? Number(s.open) : null,
    high: s.high != null ? Number(s.high) : null,
    low: s.low != null ? Number(s.low) : null,
    ldcp: s.ldcp != null ? Number(s.ldcp) : null,
    quote_date: s.date || null,
    scrape_timestamp: s.scrape_timestamp || null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Sync funds from Fintraxa to Supabase. Only fetches when API has newer data (unless forceSync).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ forceSync?: boolean }} opts
 * @returns {{ synced: boolean, count: number, skipped: boolean, error?: string }}
 */
export async function syncFunds(supabase, opts = {}) {
  try {
    if (!opts.forceSync) {
      const apiLast = await getFundsLastScrape();
      const { data: meta } = await supabase.from('sync_metadata').select('value').eq('key', 'funds').single();
      const ourLast = meta?.value?.last_scrape ?? null;
      if (apiLast && ourLast && new Date(apiLast) <= new Date(ourLast)) {
        return { synced: false, count: 0, skipped: true };
      }
    }

    const { data: rows, last_scrape } = await fetchAllFunds();
    const clean = rows.map(mapFundToRow).filter((r) => r.fund_name);
    if (clean.length === 0) return { synced: false, count: 0, skipped: false };

    const { error } = await supabase.from('funds').upsert(clean, {
      onConflict: 'fund_name',
      ignoreDuplicates: false,
    });
    if (error) throw error;

    await supabase.from('sync_metadata').upsert(
      { key: 'funds', value: { last_scrape: last_scrape || apiLast }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

    return { synced: true, count: clean.length, skipped: false };
  } catch (e) {
    return { synced: false, count: 0, skipped: false, error: e.message };
  }
}

/**
 * Sync stocks from Fintraxa to Supabase. Only fetches when API has newer data (unless forceSync).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ forceSync?: boolean }} opts
 * @returns {{ synced: boolean, count: number, skipped: boolean, error?: string }}
 */
export async function syncStocks(supabase, opts = {}) {
  try {
    if (!opts.forceSync) {
      const apiLast = await getStocksLastScrape();
      const { data: meta } = await supabase.from('sync_metadata').select('value').eq('key', 'stocks').single();
      const ourLast = meta?.value?.last_scrape ?? null;
      if (apiLast && ourLast && new Date(apiLast) <= new Date(ourLast)) {
        return { synced: false, count: 0, skipped: true };
      }
    }

    const { data: rows, last_scrape } = await fetchAllStocks();
    const clean = rows.map(mapStockToRow).filter((r) => r.symbol);
    if (clean.length === 0) return { synced: false, count: 0, skipped: false };

    const { error } = await supabase.from('stocks').upsert(clean, {
      onConflict: 'symbol',
      ignoreDuplicates: false,
    });
    if (error) throw error;

    await supabase.from('sync_metadata').upsert(
      { key: 'stocks', value: { last_scrape: last_scrape || apiLast }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

    return { synced: true, count: clean.length, skipped: false };
  } catch (e) {
    return { synced: false, count: 0, skipped: false, error: e.message };
  }
}

/**
 * Sync both funds and stocks. Only fetches from API when each source has updated data.
 * @param {{ forceSync?: boolean }} opts
 */
export async function syncAll(supabase, opts = {}) {
  const [fundResult, stockResult] = await Promise.all([
    syncFunds(supabase, opts),
    syncStocks(supabase, opts),
  ]);
  return { funds: fundResult, stocks: stockResult };
}

/** Map DB fund row to shape expected by AddFund (fund_name, fund_category, nav, offer_price, repurchase_price, trustee). */
export function mapFundToOption(row) {
  return {
    fund_name: row.fund_name,
    fund_category: row.fund_category ?? undefined,
    nav: row.nav,
    offer_price: row.offer_price ?? row.nav,
    repurchase_price: row.repurchase_price ?? row.nav,
    trustee: row.trustee ?? undefined,
  };
}

/** Map DB stock row to shape expected by SharesPage (symbol, current, change, change_pct, volume). */
export function mapStockToOption(row) {
  return {
    symbol: row.symbol,
    company: row.company_name ?? row.symbol,
    company_name: row.company_name,
    current: row.current_price,
    close: row.current_price,
    ldcp: row.ldcp ?? row.current_price,
    change: row.change_amount ?? 0,
    change_pct: row.change_pct ?? 0,
    volume: row.volume ?? 0,
  };
}
