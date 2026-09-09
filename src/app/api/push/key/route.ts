import { getPushConfig } from "@/lib/push";

export const runtime = "nodejs";

// The public VAPID key the phone needs to subscribe. Public key only — safe.
export async function GET() {
  const cfg = await getPushConfig();
  if (!cfg.publicKey) return Response.json({ error: "not-configured" }, { status: 503 });
  return Response.json({ publicKey: cfg.publicKey });
}
