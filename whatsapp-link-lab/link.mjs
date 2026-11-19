// Isolated experimental implementation. No data is written to disk.
// These controls are not sufficient for an Internet-facing deployment.
import makeWASocket, { initAuthCreds, proto, Browsers, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';

const silent = pino({ level: 'silent' });
const MAX_CHATS = 100, MAX_PER_CHAT = 40, MAX_TEXT = 4000;
const clean = s => typeof s === 'string' ? s.slice(0, MAX_TEXT) : '';

// Basic volatile Signal keystore, one store for one socket/session.
export function memoryAuth() {
  const creds = initAuthCreds(), map = new Map();
  const keys = {
    async get(type, ids) {
      const out = {};
      for (const id of ids) {
        const value = map.get(type + ':' + id);
        if (value !== undefined) out[id] = type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(value) : value;
      }
      return out;
    },
    async set(data) {
      for (const [type, entries] of Object.entries(data)) for (const [id, value] of Object.entries(entries)) {
        const key = type + ':' + id;
        if (key.length > 1024) throw new Error('signal_key_too_long');
        if (value == null) map.delete(key);
        else {
          if (!map.has(key) && map.size >= 20000) throw new Error('signal_key_capacity');
          map.set(key, value);
        }
      }
    },
    async clear() { map.clear(); }
  };
  return { state: { creds, keys }, clear: () => map.clear() };
}

function messageText(message) {
  return clean(message?.conversation || message?.extendedTextMessage?.text || message?.imageMessage?.caption || message?.videoMessage?.caption || '');
}
function ingest(s, messages) {
  if (!Array.isArray(messages)) return;
  for (const m of messages.slice(-2000)) {
    const jid = m?.key?.remoteJid;
    const id = m?.key?.id;
    const text = messageText(m?.message);
    if (typeof jid !== 'string' || jid.length > 256 || typeof id !== 'string' || id.length > 256 || !text || jid === 'status@broadcast') continue;
    if (!s.chats.has(jid)) {
      if (s.chats.size >= MAX_CHATS) s.chats.delete(s.chats.keys().next().value);
      s.chats.set(jid, []);
    }
    const list = s.chats.get(jid);
    if (list.some(x => x.id === id)) continue;
    list.push({ id, text, fromMe: !!m.key.fromMe });
    if (list.length > MAX_PER_CHAT) list.splice(0, list.length - MAX_PER_CHAT);
  }
}

// Socket factory is injected in tests; production Baileys is used only when explicitly started.
export function createLinkManager({ socketFactory = makeWASocket, capacity = 10, timeoutMs = 120000 } = {}) {
  const owners = new Map();
  function destroy(owner, s, close = true) {
    if (owners.get(owner) !== s) return;
    owners.delete(owner); s.dead = true; clearTimeout(s.timer); s.auth.clear(); s.chats.clear();
    if (close) { try { s.socket?.end?.(undefined); } catch {} }
  }
  function open(owner, s) {
    if (s.dead) return;
    const socket = socketFactory({ auth: s.auth.state, logger: silent, printQRInTerminal: false, browser: Browsers.ubuntu('Chrome'), syncFullHistory: false, markOnlineOnConnect: false });
    s.socket = socket;
    socket.ev.on('creds.update', update => { if (!s.dead) Object.assign(s.auth.state.creds, update); });
    socket.ev.on('messages.upsert', ({ messages }) => { if (!s.dead) ingest(s, messages); });
    socket.ev.on('messaging-history.set', ({ messages }) => { if (!s.dead) ingest(s, messages); });
    socket.ev.on('connection.update', update => {
      if (s.dead || s.socket !== socket) return;
      // Baileys emits "connecting" on nextTick before its websocket is open.
      // QR data here is a readiness signal only; never render, persist, or log it.
      if (update.qr) s.ready();
      if (update.connection === 'open') { s.status = 'connected'; clearTimeout(s.timer); }
      if (update.connection === 'close') {
        const code = update.lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.restartRequired && s.restarts++ < 2) { open(owner, s); return; }
        destroy(owner, s);
      }
    });
  }
  async function pair(owner, phone) {
    if (typeof owner !== 'string' || !/^[0-9a-f-]{36}$/i.test(owner)) throw new Error('invalid_owner');
    if (typeof phone !== 'string' || !/^[1-9][0-9]{7,14}$/.test(phone)) throw new Error('invalid_phone');
    if (owners.has(owner)) throw new Error('already_linked');
    if (owners.size >= capacity) throw new Error('capacity');
    let ready;
    const readyPromise = new Promise(resolve => { ready = resolve; });
    const s = { auth: memoryAuth(), chats: new Map(), status: 'pairing', dead: false, restarts: 0, socket: null, ready };
    owners.set(owner, s);
    s.timer = setTimeout(() => destroy(owner, s), timeoutMs); s.timer.unref?.();
    try {
      open(owner, s);
      await Promise.race([readyPromise, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('timeout')), Math.min(timeoutMs, 15000)); t.unref?.(); })]);
      if (s.dead) throw new Error('cancelled');
      const code = await s.socket.requestPairingCode(phone);
      if (s.dead) throw new Error('cancelled');
      if (typeof code !== 'string' || !/^[A-Z0-9]{8}$/i.test(code)) throw new Error('invalid_code');
      return code;
    } catch (e) { destroy(owner, s); throw e; }
  }
  function status(owner) { const s = owners.get(owner); return { status: s?.status || 'unlinked' }; }
  function chats(owner) {
    const s = owners.get(owner);
    if (!s || s.status !== 'connected') return [];
    return [...s.chats.entries()].map(([jid, messages]) => ({ jid, messages: messages.map(m => ({ ...m })) }));
  }
  async function unlink(owner) {
    const s = owners.get(owner); if (!s) return;
    const socket = s.socket; destroy(owner, s, false);
    // Best effort remote revocation; local access is removed immediately.
    try { await Promise.race([socket.logout(), new Promise((_, reject) => { const t = setTimeout(() => reject(Error('timeout')), 3000); t.unref?.(); })]); }
    catch {}
    finally { try { socket.end?.(undefined); } catch {} }
    // Baileys logout sends a request but does not provide a server acknowledgement.
    return { localRemoved: true, remoteRemovalConfirmed: false };
  }
  return { pair, status, chats, unlink };
}
