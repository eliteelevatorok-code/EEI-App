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
  // Tapping the alert opens the app straight to the first elevator that needs
  // you (its profile), where the action is. The body names the building and the
  // action so the alert is worth reading on its own.
  const title = n === 1 ? items[0].building : `${n} elevators need you`;
  const body =
    n === 1
      ? items[0].what
      : items.slice(0, 3).map((i) => `${i.building}: ${i.what}`).join(" · ") + (n > 3 ? ` …+${n - 3} more` : "");
  const url = `/?open=${encodeURIComponent(items[0].okla)}`;

  const res = await sendAlert(title, body, url);
  return Response.json({ ok: true, needing: n, ...res });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
