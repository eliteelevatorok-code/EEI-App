import { getPushConfig } from "@/lib/push";

// The Make automation calls a few public endpoints on its schedule
// (/api/push/run, /api/invoice/run, /api/switches/master). They're reachable
// without a login, so each one must carry the secret `pushRunSecret` (kept in the
// dashboard's private Config tab; only the Make scenarios know it) in an
// `x-scheduler-key` header. A header, not ?key= in the address, because
// addresses get written into server and Make logs.
// TRANSITION: ?key= is still accepted until the Make scenarios send the header.
// Returns a 403 response to send back when the key is wrong, or null when it's good.
export async function rejectUnlessScheduler(req: Request): Promise<Response | null> {
  const key = req.headers.get("x-scheduler-key") ?? new URL(req.url).searchParams.get("key") ?? "";
  const { runSecret } = await getPushConfig();
  if (!runSecret || key !== runSecret) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}
