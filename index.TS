// Supabase Edge Function: sends a Web Push so the other person's phone rings even if the app is closed.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const { to, callId, kind, type } = await req.json();
    if (!to || !callId || !["invite", "missed"].includes(type)) return json({ error: "bad request" }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await admin.from("profiles").select("full_name, username").eq("id", user.id).single();
    const name = me?.full_name || me?.username || "Someone";
    const label = kind === "video" ? "video" : "voice";

    const payload = JSON.stringify({
      type, callId, kind, from: user.id,
      title: name,
      body: type === "invite" ? `Incoming ${label} call` : `Missed ${label} call`,
    });

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );

    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", to);
    let sent = 0;
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: type === "invite" ? 45 : 3600, urgency: "high" },
        );
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
      }
    }));
    return json({ sent });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});