// Loopback lab only; not a production server. Never use real accounts here.
import { makeServer } from './http.mjs';
import { createLinkManager } from './link.mjs';

const url = new URL(process.env.STAGING_SUPABASE_URL || '');
const originUrl = new URL(process.env.STAGING_APP_ORIGIN || '');
const origin = originUrl.origin;
const key = process.env.STAGING_SUPABASE_ANON_KEY || '';
if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.pathname !== '/' || url.search || url.username || url.password) throw Error('A staging Supabase HTTPS project origin is required');
if (originUrl.href !== origin + '/' || !(originUrl.protocol === 'https:' || (originUrl.protocol === 'http:' && ['localhost','127.0.0.1'].includes(originUrl.hostname)))) throw Error('An exact staging browser origin is required');
if (key.length < 20) throw Error('Staging public anon key required');
const port = Number(process.env.LAB_PORT || 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid lab port');

async function verify(token) {
  try {
    const response = await fetch(new URL('/auth/v1/user', url), { headers: { apikey: key, authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (!response.ok) return null;
    const user = await response.json();
    return user?.role === 'authenticated' ? user.id : null;
  } catch { return null; }
}
const server = makeServer({ origin, verify, manager: createLinkManager() });
server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 50;
server.listen(port, '127.0.0.1', () => console.log('Rada isolated lab listening on loopback; no real accounts.'));
