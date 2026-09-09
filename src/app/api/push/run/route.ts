import { actionNeeded, getPushConfig, sendAlert } from "@/lib/push";

export const runtime = "nodejs";

// Called on a schedule (by the hourly Make "push alerts" scenario) to check what
// needs a human and buzz the phones. Public route, but guarded by the secret in
// the Config tab so only the scheduler can trigger a send.
async function handle(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const cfg = await getPushConfig();
  if (!cfg.runSecret || key !== cfg.runSecret) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const items = await actionNeeded();
  if (items.length === 0) return Response.json({ ok: true, needing: 0, sent: 0 });

  const n = items.length;
  const first = items.slice(0, 3).map((i) => `${i.building}: ${i.what}`).join(" · ");
  const title = n === 1 ? "1 elevator needs you" : `${n} elevators need you`;
  const body = n > 3 ? `${first} …and ${n - 3} more` : first;

  const res = await sendAlert(title, body, "/");
  return Response.json({ ok: true, needing: n, ...res });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
