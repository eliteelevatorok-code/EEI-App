import { findInvoiceable, findInvoiceableRow, invoiceOne, reconcilePaid, type InvoiceResult } from "@/lib/invoice";

export const runtime = "nodejs";

// GET /api/invoice → preview: which rows are ready to be invoiced, and which
// eligible rows were skipped (and why). Reads only; changes nothing.
export async function GET() {
  try {
    const { ready, skipped } = await findInvoiceable();
    return Response.json({
      ready: ready.map((e) => ({ row: e.row, building: e.building, amount: e.amount, email: e.email })),
      skipped,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Read failed" }, { status: 502 });
  }
}

// POST { row } → invoice that one row. POST { all: true } → invoice every ready
// row. POST { reconcile: true } → read QuickBooks balances and mark any settled
// invoice's row Paid. Creates the QuickBooks invoice, stores its id, marks
// Invoice = "Sent".
export async function POST(req: Request) {
  let body: { row?: number; all?: boolean; reconcile?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (body.reconcile) {
      const result = await reconcilePaid();
      return Response.json({ ok: true, ...result });
    }
    if (body.all) {
      const { ready } = await findInvoiceable();
      const results: InvoiceResult[] = [];
      for (const el of ready) results.push(await invoiceOne(el));
      return Response.json({ ok: true, invoiced: results });
    }

    const row = body.row;
    if (!Number.isInteger(row) || (row as number) < 2 || (row as number) > 100000) {
      return Response.json({ error: "Bad row" }, { status: 400 });
    }
    const el = await findInvoiceableRow(row as number);
    if (!el) return Response.json({ error: "That row has no email or price to invoice." }, { status: 400 });
    const result = await invoiceOne(el);
    return Response.json({ ok: true, invoiced: [result] });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Invoicing failed" }, { status: 502 });
  }
}
