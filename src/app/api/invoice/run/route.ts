import { findInvoiceableRow, invoiceOne, reconcilePaidRow, reconcilePaid } from "@/lib/invoice";
import { getPushConfig } from "@/lib/push";

export const runtime = "nodejs";

// Public, secret-guarded endpoint the Make automation calls on its schedule —
// the same pattern as /api/push/run. It reuses the tested invoice code, which
// already honors the on/off switches, so Make never has to build QuickBooks
// logic by hand.
//
//   /api/invoice/run?key=SECRET&row=N          → create the invoice for row N
//   /api/invoice/run?key=SECRET&reconcileRow=N → mark row N paid if its balance is 0
//   /api/invoice/run?key=SECRET&reconcile=1    → reconcile every row
async function handle(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const cfg = await getPushConfig();
  if (!cfg.runSecret || key !== cfg.runSecret) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const reconcileRow = url.searchParams.get("reconcileRow");
    if (reconcileRow) {
      const row = parseInt(reconcileRow, 10);
      if (!Number.isInteger(row) || row < 2) return Response.json({ error: "bad row" }, { status: 400 });
      return Response.json({ ok: true, ...(await reconcilePaidRow(row)) });
    }

    if (url.searchParams.get("reconcile")) {
      return Response.json({ ok: true, ...(await reconcilePaid()) });
    }

    const rowParam = url.searchParams.get("row");
    if (rowParam) {
      const row = parseInt(rowParam, 10);
      if (!Number.isInteger(row) || row < 2) return Response.json({ error: "bad row" }, { status: 400 });
      const el = await findInvoiceableRow(row);
      if (!el) return Response.json({ ok: true, invoiced: false, skipped: "not invoiceable (paused, no email/price, or missing)" });
      const result = await invoiceOne(el);
      return Response.json({ ok: true, invoiced: true, ...result });
    }

    return Response.json({ error: "nothing to do — pass row, reconcileRow, or reconcile" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "failed" }, { status: 502 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
