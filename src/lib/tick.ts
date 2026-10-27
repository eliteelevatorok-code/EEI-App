import { FAST_ORDER, FAST_STEPS } from "@/lib/fasttrack";
import { FAST_COL, cell, readRows, type Col } from "@/lib/sheet";
import { isRowPaused } from "@/lib/switches";

// The automation (Make "daily lifecycle") checks in every 15 minutes, day and
// night. This decides what each check may do:
//   normal — the steps on their usual timing (and the report, invoice and
//            payment steps): once an hour, 7am–6pm Oklahoma time, as before.
//   run    — whether to read the dashboard at all: on those hourly checks, or
//            whenever a fast-tracked step's time has come (any hour), so a fast
//            track goes within 15 minutes of the time picked for it.
// Robert (2026-10-26): a step fast-tracked for 6:35pm never went — the
// automation only ran 7am–6pm.

function oklahomaClock(now: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: n("hour"), minute: n("minute") };
}

// One check per hour lands in the first 15 minutes of the hour (checks are 15
// minutes apart), so that one does the normal hourly work.
export function isNormalCheck(now = new Date()): boolean {
  const { hour, minute } = oklahomaClock(now);
  return hour >= 7 && hour <= 18 && minute < 15;
}

// A fast-tracked step is due: its time has come and the step hasn't gone yet
// (the automation clears the time once it sends the step).
export async function fastTrackDue(now = new Date()): Promise<boolean> {
  const rows = await readRows();
  return rows.some(
    (r) =>
      !!cell(r, "okla") &&
      !isRowPaused(r) &&
      FAST_ORDER.some((k) => {
        const t = Date.parse(cell(r, FAST_COL[k]));
        const done = cell(r, FAST_STEPS[k].stage as Col);
        return Number.isFinite(t) && t <= now.getTime() && (k === "safety" ? !done : done !== "Sent");
      }),
  );
}
