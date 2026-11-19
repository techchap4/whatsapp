'use strict';

// Review-only, transport-neutral fail-closed response. It never parses input,
// authenticates a user, creates sessions, starts a connection, or reads chats.
// It is NOT wired into the PWA or any server.
function unavailable() {
  return {
    status: 503,
    headers: {
      'Cache-Control': 'no-store, private',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    },
    body: { error: 'whatsapp_linking_unavailable' }
  };
}
module.exports = { unavailable };
