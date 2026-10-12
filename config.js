// Supabase Dashboard > Project Settings > API
// Use the Project URL and the "anon / public" key (never the service_role key).
window.SUPABASE_URL = "https://awdlhvvvujrblxontopa.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_many0PakRzGrhANjafbWbA_V1WS2aSC";

// ---------- CALLS ----------
// STUN alone only works on some networks. Phones on mobile data (Safaricom/Airtel etc.) almost always
// need a TURN relay, otherwise calls ring but never connect. Get free credentials from
// https://www.metered.ca/tools/openrelay/ (or Cloudflare Calls TURN) and paste them below.
window.ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  // { urls: ["turn:YOUR-TURN-HOST:80", "turn:YOUR-TURN-HOST:443?transport=tcp", "turns:YOUR-TURN-HOST:443?transport=tcp"],
  //   username: "YOUR_TURN_USERNAME", credential: "YOUR_TURN_PASSWORD" },
];

// ---------- RINGING WHEN THE APP IS CLOSED (Web Push) ----------
// Public VAPID key from:  npx web-push generate-vapid-keys   (see SETUP.md). Leave "" to disable.
window.VAPID_PUBLIC_KEY = "BLqaXsu3N8EEmc8vqBntCBZC6Afsi41BpEulx2SAjaqv7LhgzKcNWpd0BayjoAVTjqyJpRGcbknFEGXWF2PKUH8";