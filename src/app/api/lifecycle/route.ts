import { writeCell } from "@/lib/google";
import { toIsoDate } from "@/lib/records";
import { LIFECYCLE_DEFS } from "@/lib/roster";
import { FIRST_ROW, NoSuchRow, TAB, requireElevatorRow } from "@/lib/sheet";

export const runtime = "nodejs";

// POST { row, okla, col, value } → set one lifecycle cell (the profile screen's
// "tap a step to change it"). Guarded: lifecycle columns only; never the locked
// Report step (it's set only once the report has been emailed); the value must
// be one of that step's choices (or blank to clear); the Trip day must be a real
// date (saved M/D/YYYY); and the OK # must match, so a moved row can't be hit.
export async function POST(req: Request) {
  let body: { row?: number; okla?: string; col?: string; value?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { row, col } = body;
  if (!Number.isInteger(row) || (row as number) < FIRST_ROW || (row as number) > 100000) {
    return Response.json({ error: "Bad row" }, { status: 400 });
  }
  if (!String(body.okla ?? "").trim()) return Response.json({ error: "Missing elevator" }, { status: 400 });
  const def = LIFECYCLE_DEFS.find((d) => d.col === col);
  if (!def) return Response.json({ error: "Column not editable here" }, { status: 400 });
  if (def.locked) {
    return Response.json({ error: "The report step is set automatically once the report has been emailed." }, { status: 400 });
  }
  if (typeof body.value !== "string" || body.value.length > 200) return Response.json({ error: "Bad value" }, { status: 400 });
  let value = body.value.trim();
  if (value && def.date) {
    const iso = toIsoDate(value);
    const [y, m, d] = iso.split("-").map(Number); // Date.UTC rolls month 13 over instead of throwing → mismatch → refused
    const ok = !!iso && new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === iso;
    if (!ok) return Response.json({ error: "Pick a real date." }, { status: 400 });
    value = `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}/${iso.slice(0, 4)}`;
  } else if (value && !def.options.includes(value)) {
    return Response.json({ error: `${def.label} can only be ${def.options.map((o) => `"${o}"`).join(" or ")} (or cleared).` }, { status: 400 });
  }
  try {
    const at = await requireElevatorRow(row as number, body.okla); // the right elevator, even if rows moved
    await writeCell(`${TAB}!${def.col}${at}`, value);
    return Response.json({ ok: true, col: def.col, row: at, value });
  } catch (err) {
    if (err instanceof NoSuchRow) return Response.json({ error: err.message }, { status: 404 });
    return Response.json({ error: "Couldn't save just now — try again in a minute." }, { status: 502 });
  }
}
