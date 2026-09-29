import { invoiceRow, reconcileRow } from "@/lib/invoice";
import { rejectUnlessScheduler } from "@/lib/schedulerKey";
import { FIRST_ROW } from "@/lib/sheet";

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
    const n = parseInt(v ?? "", 10);
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
      return Response.json({ ok: true, ...(await invoiceRow(row)) });
    }
    return Response.json({ error: "pass row or reconcileRow" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "failed" }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
