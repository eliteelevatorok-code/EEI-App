import { appendElevator, findRowByOkla, type NewElevatorInput } from "@/lib/roster";
import { TECH_KEYS } from "@/lib/tech";

export const runtime = "nodejs";

const FIELDS: (keyof NewElevatorInput)[] = [
  "okla", "building", "area", "city", "account", "contact", "email", "phone",
  "maintCo", "maintContact", "maintEmail", "maintPhone", "type", "floors", "cycle",
  "price", "moneyPath", "due",
  ...TECH_KEYS, // the state-form details (serial, permit, owner, …) — saved so every report has them
];

// POST a new elevator → append it as a row on the dashboard.
export async function POST(req: Request) {
  let body: Partial<Record<keyof NewElevatorInput, string>>;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // Minimum needed to be a usable record.
  if (!body.okla?.trim() || !body.building?.trim() || !body.account?.trim()) {
    return Response.json({ error: "Oklahoma #, Building, and Account are required." }, { status: 400 });
  }
  // Build a clean, string-only, length-capped record.
  const clean = {} as NewElevatorInput;
  for (const k of FIELDS) clean[k] = String(body[k] ?? "").slice(0, 200).trim();

  try {
    // One row per OK #: a second row with the same number would confuse every lookup.
    if (await findRowByOkla(clean.okla)) {
      return Response.json({ error: `OK # ${clean.okla} is already on the dashboard.` }, { status: 409 });
    }
    const row = await appendElevator(clean);
    return Response.json({ ok: true, okla: clean.okla, row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't save the elevator";
    return Response.json({ error: message }, { status: 502 });
  }
}
