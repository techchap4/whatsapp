// Supabase Edge Function: sends a Web Push for every new chat message,
// so the receiver sees a notification even when Rada is closed.
// Called by a database trigger on public.messages (see message_push.sql).
import { createClient } from "npm:@supabase/supabase-js";
import webpush from "npm:web-push";

type MessageRow = {
  id?: string | number;
  sender_id?: string;
  receiver_id?: string;
  content?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  media_name?: string | null;
};

type PushSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    // only our database trigger may call this function
    const secret = Deno.env.get("MESSAGE_PUSH_SECRET");
    if (!secret || req.headers.get("x-webhook-secret") !== secret) {
      return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json();
    const m = (body.record ?? body) as MessageRow;
    if (!m.sender_id || !m.receiver_id || m.sender_id === m.receiver_id) {
      return json({ skipped: "no receiver" });
    }
    // call history lines are handled by call-push
    if (typeof m.content === "string" && m.content.startsWith("[[call:")) {
      return json({ skipped: "call line" });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRoleKey) return json({ error: "missing supabase configuration" }, 500);

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!vapidPublicKey || !vapidPrivateKey) return json({ error: "missing vapid configuration" }, 500);

    const admin = createClient(url, serviceRoleKey);

    // Notification preferences are stored on the receiver's profile. Fail closed
    // on a lookup error rather than sending an alert contrary to their choice.
    const { data: recipient, error: profileError } = await admin
      .from("profiles").select("settings").eq("id", m.receiver_id).single();
    if (profileError || !recipient) return json({ error: "notification settings unavailable" }, 500);
    const notif = recipient.settings?.notif;
    if (notif?.messages === false || notif?.desktop === false) {
      return json({ skipped: "message notifications disabled" });
    }

    // Only the routing identifier is necessary; never send a name, text,
    // filename, avatar, or message ID in the push payload.
    const payload = JSON.stringify({ type: "message", from: m.sender_id });

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
      vapidPublicKey,
      vapidPrivateKey,
    );

    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", m.receiver_id);
    const subscriptions = (subs ?? []) as PushSubscription[];
    let sent = 0;

    await Promise.all(
      subscriptions.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 86400, urgency: "high" },
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