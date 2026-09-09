import { saveSubscription } from "@/lib/push";

export const runtime = "nodejs";

// Save this phone's push subscription so alerts can reach it later.
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
  try {
    await saveSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 502 });
  }
}
