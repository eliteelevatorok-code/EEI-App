import { saveSubscription } from "@/lib/push";

export const runtime = "nodejs";

// Save this phone's push subscription so alerts can reach it later. Answers
// { ok, renew } — renew = true means Google already said this sign-up is dead,
// so the phone should throw it away and sign up fresh (push-client.ts does).
export async function POST(req: Request) {
  let body: { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return Response.json({ error: "Bad subscription" }, { status: 400 });
  }
  // A real phone sign-up is always a secure web address at a push service.
  let host = "";
  try {
    const u = new URL(sub.endpoint);
    host = u.protocol === "https:" ? u.host : "";
  } catch {
    /* not an address */
  }
  if (!host || sub.endpoint.length > 1000) return Response.json({ error: "Bad subscription" }, { status: 400 });
  try {
    const result = await saveSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    return Response.json({ ok: true, renew: result === "gone" });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 502 });
  }
}
