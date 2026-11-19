'use strict';

// INACTIVE prototype only. Not an authentication or persistence layer.
// Never pass it unverified identities or connect it to production.
const { randomUUID } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TTL_MS = 5 * 60 * 1000;

function createOwnerState({ clock = Date.now, makeId = randomUUID, capacity = 1000 } = {}) {
  if (typeof clock !== 'function' || typeof makeId !== 'function' || !Number.isSafeInteger(capacity) || capacity < 1) throw new TypeError('Invalid configuration');
  const sessions = new Map();
  function now() {
    const t = clock();
    if (!Number.isSafeInteger(t) || t < 0 || t > Number.MAX_SAFE_INTEGER - MAX_TTL_MS) throw new Error('Invalid clock');
    return t;
  }
  function ownerId(id) {
    if (typeof id !== 'string' || !UUID.test(id)) throw new TypeError('A verified UUID principal is required');
    return id.toLowerCase();
  }
  function prune(t) {
    for (const [id, session] of sessions) if (session.expiresAt <= t) sessions.delete(id);
  }
  // No caller-provided metadata, phone number, pairing code, credential or chat is accepted.
  function begin(principal) {
    const owner = ownerId(principal);
    const t = now();
    prune(t);
    for (const session of sessions.values()) if (session.owner === owner) return null;
    if (sessions.size >= capacity) return null;
    const id = makeId();
    if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Invalid session id');
    const key = id.toLowerCase();
    if (sessions.has(key)) throw new Error('Session id collision');
    const session = { id: key, owner, expiresAt: t + MAX_TTL_MS };
    sessions.set(key, session);
    return { id: key, state: 'pending', expiresAt: session.expiresAt };
  }
  function get(principal, id) {
    const owner = ownerId(principal);
    const t = now();
    prune(t);
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    const session = sessions.get(id.toLowerCase());
    if (!session || session.owner !== owner) return null;
    return { id: session.id, state: 'pending', expiresAt: session.expiresAt };
  }
  function cancel(principal, id) {
    const item = get(principal, id);
    return item ? sessions.delete(item.id) : false;
  }
  return Object.freeze({ begin, get, cancel });
}
module.exports = { createOwnerState };
