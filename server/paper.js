// Alpaca paper-trading client. Uses the same API keys as market data, but
// against the paper trading host — real order simulation, fake money.
import { cfg } from './config.js';

const PAPER_BASE = 'https://paper-api.alpaca.markets';

function authHeaders() {
  return {
    'APCA-API-KEY-ID': cfg('ALPACA_API_KEY_ID'),
    'APCA-API-SECRET-KEY': cfg('ALPACA_API_SECRET_KEY'),
    'Content-Type': 'application/json',
  };
}

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${PAPER_BASE}${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.message || json?.raw || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

export function getAccount() {
  return call('/v2/account');
}

export function getPositions() {
  return call('/v2/positions');
}

// status: 'open' | 'closed' | 'all' (whitelisted to avoid query injection)
export function getOrders(status = 'open') {
  const s = ['open', 'closed', 'all'].includes(status) ? status : 'open';
  return call(`/v2/orders?status=${s}&limit=50&nested=true`);
}

export function placeOrder(order) {
  return call('/v2/orders', { method: 'POST', body: order });
}

export function cancelOrder(id) {
  return call(`/v2/orders/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function closePosition(symbol) {
  return call(`/v2/positions/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
}
