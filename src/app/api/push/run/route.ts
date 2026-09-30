import { alertItems, readSent, saveSent, sendAlert, todayNum, type AlertItem } from "@/lib/push";
import { rejectUnlessScheduler } from "@/lib/schedulerKey";

export const runtime = "nodejs";

// Called every hour by the Make "push alerts" scenario.
//
// First run of the day (7am Oklahoma time — Make runs on New York time, 8am–7pm
// there): ONE summary of everything that needs a person today.
// Other hours: buzz only about things that are NEW since the last alert — so a
// task that's still waiting doesn't buzz you every hour.
//
// Tapping an alert: one item → opens that elevator (its "Next step" card has the
// button to act: start the report, call/email). Several → opens the Today tab.
//
// ?summary=1 forces the morning summary; ?dry=1 shows what would be sent
// without sending or remembering anything (for checking the wording).
// ?test=1 sends today's summary right now marked "Test", even with the master
// switch off, and remembers nothing — to prove alerts reach the phones.
async function handle(req: Request) {
  const denied = await rejectUnlessScheduler(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const dry = params.has("dry");

  if (params.has("test")) {
    // ?test=1 → the day's summary; ?test=item&n=2 → just the 2nd waiting item,
    // exactly as that single alert would look (tap opens that elevator).
    const items = await alertItems(true);
    const n = Math.max(0, Number(params.get("n") ?? 1) - 1);
    const pick = params.get("test") === "item" && items[n] ? [items[n]] : items;
    const a = pick.length ? compose(pick, true) : null;
    const title = (params.get("test") === "item" ? "" : "Test: ") + (a?.title ?? "nothing needs you right now");
    const result = await sendAlert(title, "", a?.url ?? "/", `eei-test-${Date.now()}`);
    return Response.json({ ok: true, test: true, title, ...result });
  }

  const [items, sent] = await Promise.all([alertItems(), readSent()]);
  // The first run of the day (Make starts at 7am Oklahoma time) is the summary.
  const morning = params.has("summary") || sent.day !== todayNum();
  const toSend = morning ? items : items.filter((i) => !sent.keys.has(i.key));

  const alert = toSend.length ? compose(toSend, morning) : null;
  let result = { sent: 0, pruned: 0 };
  if (!dry) {
    if (alert) result = await sendAlert(alert.title, alert.body, alert.url, alert.tag);
    // Remember today + what's currently waiting (things that went away drop off).
    await saveSent(items.map((i) => i.key));
  }
  return Response.json({ ok: true, morning, waiting: items.length, alert, dry, ...result, ...(dry ? { items } : {}) });
}

// One short line per alert — Robert reads the title and taps. The screen it
// opens has the details and the button to act, so the alert itself carries none.
//   one thing  → its own line, e.g. "Inspection today: Guymon Senior Center"; opens that elevator
//   several    → "7 things need you today"; opens the Today tab (the list, each with its action)
function compose(list: AlertItem[], morning: boolean) {
  if (list.length === 1) {
    const i = list[0];
    return { title: i.title, body: "", url: `/?open=${encodeURIComponent(i.okla)}`, tag: `eei-${i.key}` };
  }
  return {
    title: morning ? `${list.length} things need you today` : `${list.length} new things need you`,
    body: "",
    url: "/?tab=today",
    tag: "eei-summary",
  };
}

export const GET = handle;
export const POST = handle;
