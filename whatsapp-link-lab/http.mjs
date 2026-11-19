import { createServer } from 'node:http';

// Deliberately loopback-only. Auth provider MUST verify the bearer token remotely.
export function makeServer({ origin, verify, manager }) {
  const limits = new Map();
  function rate(key, max, window) {
    const t = Date.now(), e = limits.get(key);
    if (limits.size > 2000) for (const [k,v] of limits) if (v.until <= t) limits.delete(k);
    if (limits.size > 2000 && !limits.has(key)) return false;
    if (!e || e.until <= t) { limits.set(key, { n: 1, until: t + window }); return true; }
    if (e.n >= max) return false; e.n++; return true;
  }
  return createServer(async (req, res) => {
    const headers = { 'Cache-Control': 'no-store, private', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Origin' };
    if (req.headers.origin === origin) headers['Access-Control-Allow-Origin'] = origin;
    const send = (status, obj) => { if (!res.headersSent && !res.destroyed) { res.writeHead(status, headers); res.end(JSON.stringify(obj)); } };
    try {
      if (req.headers.origin !== origin || !rate('ip:' + req.socket.remoteAddress, 150, 60000)) return send(403, { error: 'forbidden' });
      if (req.method === 'OPTIONS') {
        headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'authorization, content-type';
        headers['Access-Control-Allow-Private-Network'] = 'true';
        res.writeHead(204, headers); return res.end();
      }
      const match = /^Bearer ([A-Za-z0-9._-]{10,4096})$/.exec(req.headers.authorization || '');
      if (!match) return send(401, { error: 'unauthorized' });
      const owner = await verify(match[1]);
      if (typeof owner !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner)) return send(401, { error: 'unauthorized' });
      if (!rate('user:' + owner, 90, 60000)) return send(429, { error: 'rate_limited' });
      // Exact path match: no query strings, no identifiers in URLs.
      if (req.method === 'GET' && req.url === '/status') return send(200, manager.status(owner));
      if (req.method === 'GET' && req.url === '/chats') return send(200, { chats: manager.chats(owner) });
      if (req.method !== 'POST' || !['/pair','/unlink'].includes(req.url)) return send(404, { error: 'not_found' });
      if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] || '')) return send(415, { error: 'content_type' });
      if (!rate('write:' + owner, 5, 60000)) return send(429, { error: 'rate_limited' });
      let text = '';
      for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 1024) return send(413, { error: 'too_large' }); }
      let body; try { body = JSON.parse(text); } catch { return send(400, { error: 'bad_request' }); }
      if (!body || Array.isArray(body) || typeof body !== 'object') return send(400, { error: 'bad_request' });
      if (req.url === '/unlink') {
        if (Object.keys(body).length !== 0) return send(400, { error: 'bad_request' });
        return send(200, await manager.unlink(owner) || { localRemoved: true, remoteRemovalConfirmed: false });
      }
      if (Object.keys(body).length !== 1 || typeof body.phone !== 'string' || !/^[1-9][0-9]{7,14}$/.test(body.phone)) return send(400, { error: 'bad_request' });
      try { return send(200, { code: await manager.pair(owner, body.phone) }); }
      catch { return send(409, { error: 'pairing_unavailable' }); }
    } catch { send(503, { error: 'unavailable' }); }
  });
}
