import { writeCells } from "@/lib/google";
import { FAST_ORDER, FAST_STEPS, fastCancelSet, fastWindow, onQuarterHour, type FastStepKey, type FastTimes } from "@/lib/fasttrack";
import { COL, FAST_COL, FIRST_ROW, NoSuchRow, TAB, cell, letter, readRow, requireElevatorRow } from "@/lib/sheet";

export const runtime = "nodejs";

// Fast track one pre-visit step (signed-in only, see proxy.ts).
//   POST { row, okla, step, at }           — send `step` early, at `at` (ISO time)
//   POST { row, okla, step, cancel: true } — drop that step's time (and the
//                                            times of the steps after it)
// The server re-checks everything against the live row (lib/fasttrack.ts
// fastWindow): the step hasn't gone, every earlier step has gone or has a time,
// and the time is ≥1h from now, ≥1h after the step before and ≥1h before the
// step after — so a tampered phone can't break the order. Each step's time goes
// in its own column (BM–BQ, ISO UTC, stored as plain text). Answers with every
// step's time after the change.
export async function POST(req: Request) {
  let body: { row?: number; okla?: string; step?: string; at?: string; cancel?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const row = Number(body.row);
  if (!Number.isInteger(row) || row < FIRST_ROW || row > 100000) return Response.json({ error: "Bad row" }, { status: 400 });
  if (!String(body.okla ?? "").trim()) return Response.json({ error: "Missing elevator" }, { status: 400 });
  const step = body.step as FastStepKey;
  if (!FAST_ORDER.includes(step)) return Response.json({ error: "Bad step" }, { status: 400 });

  try {
    const at = await requireElevatorRow(row, body.okla); // the right elevator, even if rows moved
    const r = await readRow(at);
    const times: FastTimes = Object.fromEntries(FAST_ORDER.filter((k) => cell(r, FAST_COL[k])).map((k) => [k, cell(r, FAST_COL[k])]));
    const write = async (changes: FastTimes) => {
      await writeCells(
        Object.entries(changes).map(([k, v]): [string, string] => [`${TAB}!${letter(COL[FAST_COL[k as FastStepKey]])}${at}`, v ?? ""]),
        true,
      );
      const next = { ...times, ...changes };
      return Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as FastTimes;
    };

    if (body.cancel) {
      const cleared = fastCancelSet(times, step);
      const fastTrack = await write(Object.fromEntries(cleared.map((k) => [k, ""])));
      return Response.json({ ok: true, fastTrack, cleared });
    }

    const win = fastWindow(
      {
        email: cell(r, "email"),
        price: cell(r, "price"),
        moneyPath: cell(r, "moneyPath"),
        twoMoEmail: cell(r, "twoMoEmail"),
        quote: cell(r, "quote"),
        po: cell(r, "po"),
        maintConfirm: cell(r, "maintConfirm"),
        scheduling: cell(r, "scheduling"),
        accessReminder: cell(r, "accessReminder"),
        visit: cell(r, "visit"),
        tripDay: cell(r, "tripDay"),
      },
      { ...times, [step]: undefined }, // its own old time doesn't limit the new one
      step,
      Date.now() - 60_000, // a minute of grace for the time it took to tap "Yes"
    );
    if ("none" in win) return Response.json({ error: win.none }, { status: 409 });
    const when = new Date(String(body.at ?? ""));
    const ms = when.getTime();
    if (Number.isNaN(ms)) return Response.json({ error: "Pick a date and time." }, { status: 400 });
    if (!onQuarterHour(when))
      return Response.json({ error: "Pick a time on the quarter hour (:00, :15, :30 or :45) — that's when the automation checks." }, { status: 400 });
    if (ms < win.min) {
      const prev = FAST_ORDER.slice(0, FAST_ORDER.indexOf(step)).reverse().find((k) => times[k]);
      const why = prev && new Date(times[prev]!).getTime() + 3_600_000 >= win.min
        ? `at least an hour after the ${FAST_STEPS[prev].label.toLowerCase()}`
        : "at least an hour from now";
      return Response.json({ error: `Pick a time ${why}.` }, { status: 400 });
    }
    if (ms > win.max) {
      const later = FAST_ORDER.slice(FAST_ORDER.indexOf(step) + 1).find((k) => times[k]);
      const why = later ? `at least an hour before the ${FAST_STEPS[later].label.toLowerCase()}` : "within the next year";
      return Response.json({ error: `Pick a time ${why}.` }, { status: 400 });
    }

    const iso = when.toISOString().replace(/\.\d+Z$/, "Z");
    const fastTrack = await write({ [step]: iso });
    return Response.json({ ok: true, step, at: iso, fastTrack });
  } catch (err) {
    if (err instanceof NoSuchRow) return Response.json({ error: err.message }, { status: 404 });
    return Response.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 502 });
  }
}
