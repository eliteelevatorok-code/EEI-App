import { setTechDetails } from "@/lib/roster";
import { NoSuchRow, requireElevatorRow } from "@/lib/sheet";
import { BASIC_KEYS, TECH_KEYS, type BasicKey, type TechKey } from "@/lib/tech";

export const runtime = "nodejs";

// POST { row, okla, values: { serial: "…", owner: "…", … } } → save an elevator's
// state-form details (profile → "For the state form", or the report screen's
// "fill in what's missing"). Login required. Only the known detail fields plus
// the customer basics the form prints (contact, phone, email, city); short
// text; the OK # is required so a moved row can't receive another elevator's
// details.
type Key = TechKey | BasicKey;
const ALLOWED: Key[] = [...TECH_KEYS, ...BASIC_KEYS];

export async function POST(req: Request) {
  let body: { row?: number; okla?: string; values?: Record<string, unknown> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const okla = String(body.okla ?? "").trim();
  if (!Number.isInteger(body.row) || !okla) return Response.json({ error: "Missing elevator" }, { status: 400 });
  const values: Partial<Record<Key, string>> = {};
  for (const [k, v] of Object.entries(body.values ?? {})) {
    if (!ALLOWED.includes(k as Key)) return Response.json({ error: `"${k}" isn't a state-form detail` }, { status: 400 });
    values[k as Key] = String(v ?? "").trim().slice(0, 120);
  }
  if (!Object.keys(values).length) return Response.json({ error: "Nothing to save" }, { status: 400 });
  try {
    const row = await requireElevatorRow(body.row as number, okla);
    await setTechDetails(row, values);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof NoSuchRow) return Response.json({ error: err.message }, { status: 404 });
    return Response.json({ error: "Couldn't save just now — try again in a minute." }, { status: 502 });
  }
}
