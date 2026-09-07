import { writeCell } from "@/lib/google";
import { LIFECYCLE_DEFS } from "@/lib/roster";

export const runtime = "nodejs";

// Only these dashboard columns may be written here (the lifecycle stages S..AE).
const ALLOWED = new Set(LIFECYCLE_DEFS.map((d) => d.col));

// POST { row, col, value } → set one lifecycle cell on the dashboard.
// Guarded: only lifecycle columns, a sane row number, and a short value.
export async function POST(req: Request) {
  let body: { row?: number; col?: string; value?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { row, col, value } = body;
  if (!Number.isInteger(row) || (row as number) < 3 || (row as number) > 100000) {
    return Response.json({ error: "Bad row" }, { status: 400 });
  }
  if (typeof col !== "string" || !ALLOWED.has(col)) {
    return Response.json({ error: "Column not editable here" }, { status: 400 });
  }
  if (typeof value !== "string" || value.length > 200) {
    return Response.json({ error: "Bad value" }, { status: 400 });
  }
  try {
    await writeCell(`Elevators!${col}${row}`, value);
    return Response.json({ ok: true, col, row, value });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Write failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
