import { getPushConfig } from "@/lib/push";

// The Make automation calls a few public endpoints on its schedule
// (/api/push/run, /api/invoice/run, /api/switches/master). They're reachable
// without a login, so each one requires ?key=<pushRunSecret> — a secret stored
// in the dashboard's private Config tab that only the Make scenarios know.
// Returns a 403 response to send back when the key is wrong, or null when it's good.
export async function rejectUnlessScheduler(req: Request): Promise<Response | null> {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const { runSecret } = await getPushConfig();
  if (!runSecret || key !== runSecret) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}
