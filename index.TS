// Supabase Edge Function: sends a Web Push so the other person's phone rings even if the app is closed.
import { createClient } from "npm:@supabase/supabase-js";
import webpush from "npm:web-push";

type PushRequest = {
  to?: string;
  callId?: string;
  kind?: "audio" | "voice" | "video";
  type?: "invite" | "missed";
};

type PushSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anonKey) return json({ error: "missing supabase configuration" }, 500);

    const userClient = createClient(url, anonKey, {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    });

    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) return json({ error: "unauthorized" }, 401);

    const body = (await req.json()) as PushRequest;
    const { to, callId, kind, type } = body;

    if (!to || !callId || !type || !["invite", "missed"].includes(type)) {
      return json({ error: "bad request" }, 400);
    }

    if (!kind || !["audio", "voice", "video"].includes(kind)) {
      return json({ error: "bad request" }, 400);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return json({ error: "missing supabase service role key" }, 500);

    const admin = createClient(url, serviceRoleKey);
    const { data: me } = await admin.from("profiles").select("full_name, username").eq("id", user.id).single();
    const name = me?.full_name || me?.username || "Someone";
    const label = kind === "video" ? "video" : "voice";

    const payload = JSON.stringify({
      type,
      callId,
      kind,
      from: user.id,
      title: name,
      body: type === "invite" ? `Incoming ${label} call` : `Missed ${label} call`,
    });

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!vapidPublicKey || !vapidPrivateKey) {
      return json({ error: "missing vapid configuration" }, 500);
    }

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
      vapidPublicKey,
      vapidPrivateKey,
    );

    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", to);
    const subscriptions = (subs ?? []) as PushSubscription[];
    let sent = 0;

    await Promise.all(
      subscriptions.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: type === "invite" ? 45 : 3600, urgency: "high" },
          );
          sent++;
        } catch (error) {
          const pushError = error as { statusCode?: number };
          if (pushError.statusCode === 404 || pushError.statusCode === 410) {
            await admin.from("push_subscriptions").delete().eq("id", s.id);
          }
        }
      }),
    );

    return json({ sent });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});