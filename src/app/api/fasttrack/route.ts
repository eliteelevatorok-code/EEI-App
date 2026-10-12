import { writeCells } from "@/lib/google";
import { FAST_MAX_LEAD_MS, FAST_MIN_LEAD_MS, FAST_STEPS, nextFastStep, type FastStepKey } from "@/lib/fasttrack";
import { COL, FIRST_ROW, NoSuchRow, TAB, cell, letter, readRow, requireElevatorRow } from "@/lib/sheet";

export const runtime = "nodejs";

// Elevator page → "Access fast track" (signed-in only, see proxy.ts).
//   POST { row, okla, step, at }   — send `step` early, at `at` (ISO time)
//   POST { row, okla, cancel: true } — drop a waiting fast-track step
// The server works out the elevator's next step itself and refuses any other,
// and any time less than an hour out — so a tampered phone can't skip ahead.
// Saved to cols BM (step) and BN (time, ISO UTC, stored as plain text); the
// automation sends that step at the first hourly run after the time.
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

  try {
    const at = await requireElevatorRow(row, body.okla); // the right elevator, even if rows moved
    const cells = (step: string, when: string): [string, string][] => [
      [`${TAB}!${letter(COL.ftStep)}${at}`, step],
      [`${TAB}!${letter(COL.ftAt)}${at}`, when],
    ];
    if (body.cancel) {
      await writeCells(cells("", ""), true);
      return Response.json({ ok: true, cancelled: true });
    }

    const r = await readRow(at);
    const next = nextFastStep({
      email: cell(r, "email"),
      price: cell(r, "price"),
      moneyPath: cell(r, "moneyPath"),
      twoMoEmail: cell(r, "twoMoEmail"),
      quote: cell(r, "quote"),
      maintConfirm: cell(r, "maintConfirm"),
      scheduling: cell(r, "scheduling"),
      accessReminder: cell(r, "accessReminder"),
      visit: cell(r, "visit"),
      tripDay: cell(r, "tripDay"),
    });
    if ("none" in next) return Response.json({ error: next.none }, { status: 409 });
    if (body.step !== next.step) {
      return Response.json({ error: `The next step is now the ${FAST_STEPS[next.step].label.toLowerCase()} — reopen fast track.` }, { status: 409 });
    }
    const when = new Date(String(body.at ?? ""));
    const lead = when.getTime() - Date.now();
    if (Number.isNaN(lead)) return Response.json({ error: "Pick a date and time." }, { status: 400 });
    // A minute of grace for the time it took to tap Confirm.
    if (lead < FAST_MIN_LEAD_MS - 60_000) return Response.json({ error: "Pick a time at least an hour from now." }, { status: 400 });
    if (lead > FAST_MAX_LEAD_MS) return Response.json({ error: "Pick a time within the next year." }, { status: 400 });

    const iso = when.toISOString().replace(/\.\d+Z$/, "Z");
    await writeCells(cells(next.step satisfies FastStepKey, iso), true);
    return Response.json({ ok: true, step: next.step, at: iso });
  } catch (err) {
    if (err instanceof NoSuchRow) return Response.json({ error: err.message }, { status: 404 });
    return Response.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 502 });
  }
}
