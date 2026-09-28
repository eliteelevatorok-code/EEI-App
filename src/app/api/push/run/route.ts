import { actionNeeded, sendAlert } from "@/lib/push";
import { rejectUnlessScheduler } from "@/lib/schedulerKey";

export const runtime = "nodejs";

// Called hourly by the Make "push alerts" scenario: works out which elevators
// need a person right now and buzzes every subscribed phone.
async function handle(req: Request) {
  const denied = await rejectUnlessScheduler(req);
  if (denied) return denied;

  const items = await actionNeeded();
  if (items.length === 0) return Response.json({ ok: true, needing: 0, sent: 0 });

  // The alert names the building and the action so it's worth reading on its
  // own, and tapping it opens the app straight to the first elevator's profile.
  const n = items.length;
  const title = n === 1 ? items[0].building : `${n} elevators need you`;
  const body =
    n === 1
      ? items[0].what
      : items.slice(0, 3).map((i) => `${i.building}: ${i.what}`).join(" · ") + (n > 3 ? ` …+${n - 3} more` : "");
  const url = `/?open=${encodeURIComponent(items[0].okla)}`;

  const res = await sendAlert(title, body, url);
  return Response.json({ ok: true, needing: n, ...res });
}

export const GET = handle;
export const POST = handle;
