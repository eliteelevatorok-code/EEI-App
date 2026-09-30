import { invoiceRow, reconcileRow } from "@/lib/invoice";
import { rejectUnlessScheduler } from "@/lib/schedulerKey";
import { sendProblemAlert } from "@/lib/push";
import { FIRST_ROW, cell, readRow } from "@/lib/sheet";

export const runtime = "nodejs";

// Called by the Make "daily lifecycle" scenario, once per elevator row:
//   /api/invoice/run?row=N          → bill row N in QuickBooks (route 9)
//   /api/invoice/run?reconcileRow=N → mark row N Paid if its balance is 0 (route 10)
// See src/lib/invoice.ts for the rules each step follows.
async function handle(req: Request) {
  const denied = await rejectUnlessScheduler(req);
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  const toRow = (v: string | null) => {
    const n = Number(v ?? ""); // whole numbers only — "2.5" or "2abc" is refused, not read as 2
    return Number.isInteger(n) && n >= FIRST_ROW ? n : null; // row 1 is the header
  };
  try {
    if (params.has("reconcileRow")) {
      const row = toRow(params.get("reconcileRow"));
      if (!row) return Response.json({ error: "bad row" }, { status: 400 });
      return Response.json({ ok: true, ...(await reconcileRow(row)) });
    }
    if (params.has("row")) {
      const row = toRow(params.get("row"));
      if (!row) return Response.json({ error: "bad row" }, { status: 400 });
      const result = await invoiceRow(row);
      // Skips a person has to fix (the report already went out, but the bill
      // can't): tell Robert's phone instead of silently retrying every hour.
      const needsPerson: Record<string, string> = {
        "no usable price on the row": "there's no price on this elevator",
        "no customer email on the row": "there's no customer email on this elevator",
      };
      if (!result.invoiced && needsPerson[result.skipped]) {
        const r = await readRow(row);
        await sendProblemAlert(cell(r, "okla"), cell(r, "building"), "invoice", needsPerson[result.skipped]).catch(() => {});
      }
      return Response.json({ ok: true, ...result });
    }
    return Response.json({ error: "pass row or reconcileRow" }, { status: 400 });
  } catch (err) {
    // Make treats this answer as "nothing to do" and moves on (so one elevator
    // can't stop the run) — which means nobody would hear about it. So tell
    // Robert's phone here: which elevator, and what went wrong.
    const message = err instanceof Error ? err.message : "failed";
    const row = Number(params.get("row") ?? params.get("reconcileRow"));
    const r = await readRow(row).catch(() => [] as string[]);
    await sendProblemAlert(cell(r, "okla"), cell(r, "building"), params.has("row") ? "invoice" : "payment check", message).catch(() => {});
    return Response.json({ error: message }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
