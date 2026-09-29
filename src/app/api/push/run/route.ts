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
async function handle(req: Request) {
  const denied = await rejectUnlessScheduler(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const dry = params.has("dry");

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

// Turn the items into one phone alert, in plain words.
function compose(list: AlertItem[], morning: boolean) {
  if (list.length === 1) {
    const i = list[0];
    return { title: i.title, body: i.body, url: `/?open=${encodeURIComponent(i.okla)}`, tag: `eei-${i.key}` };
  }
  // Group the same kind of thing into one sentence, the way you'd say it:
  // "Still waiting on records for 5 buildings: Lawton Civic Center, Lawton Bank Tower and 3 more."
  const kind = (i: AlertItem) => i.key.split(":")[0];
  const names = (g: AlertItem[]) =>
    g.length <= 2 ? g.map((i) => i.building).join(" and ") : `${g[0].building}, ${g[1].building} and ${g.length - 2} more`;
  const lines: string[] = [];
  for (const i of list.filter((x) => kind(x) === "inspect")) lines.push(i.title);
  const chase = list.filter((x) => kind(x) === "chase");
  if (chase.length === 1) lines.push(chase[0].title);
  else if (chase.length) lines.push(`Still waiting on records for ${chase.length} buildings: ${names(chase)}.`);
  const overdue = list.filter((x) => kind(x) === "overdue");
  if (overdue.length === 1) lines.push(overdue[0].title);
  else if (overdue.length) lines.push(`${overdue.length} buildings are past due: ${names(overdue)}.`);
  return {
    title: morning ? `Good morning — ${list.length} things need you` : `${list.length} new things need you`,
    body: lines.join("\n"),
    url: "/?tab=today",
    tag: "eei-summary",
  };
}

export const GET = handle;
export const POST = handle;
