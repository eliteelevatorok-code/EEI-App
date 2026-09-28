import { writeCell } from "@/lib/google";
import { LIFECYCLE_DEFS } from "@/lib/roster";
import { FIRST_ROW, TAB } from "@/lib/sheet";

export const runtime = "nodejs";

// Only the lifecycle stage columns (S–AE) may be written through here.
const ALLOWED = new Set(LIFECYCLE_DEFS.map((d) => d.col));

// POST { row, col, value } → set one lifecycle cell (the profile screen's
// "tap a step to change it"). Guarded: lifecycle columns only, a real data row,
// and a short value.
export async function POST(req: Request) {
  let body: { row?: number; col?: string; value?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { row, col, value } = body;
  if (!Number.isInteger(row) || (row as number) < FIRST_ROW || (row as number) > 100000) {
    return Response.json({ error: "Bad row" }, { status: 400 });
  }
  if (typeof col !== "string" || !ALLOWED.has(col)) {
    return Response.json({ error: "Column not editable here" }, { status: 400 });
  }
  if (typeof value !== "string" || value.length > 200) {
    return Response.json({ error: "Bad value" }, { status: 400 });
  }
  try {
    await writeCell(`${TAB}!${col}${row}`, value);
    return Response.json({ ok: true, col, row, value });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Write failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
