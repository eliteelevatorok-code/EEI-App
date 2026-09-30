import { recordMaint } from "@/lib/maint";
import { checkSafetyDate } from "@/lib/records";
import { FIRST_ROW, NoSuchRow, requireElevatorRow } from "@/lib/sheet";

export const runtime = "nodejs";

// POST { row, result, date } → enter the safety-test answer by hand (signed-in
// app users only — see proxy.ts). For when April or Robert gets the answer on a
// phone call instead of through the emailed form. Same rules as the form:
// result "Yes" / "No"; the date is needed only for "Yes".
export async function POST(req: Request) {
  let body: { row?: number; okla?: string; result?: string; date?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const row = Number(body.row);
  const result = String(body.result ?? "").trim();
  const date = String(body.date ?? "").trim().slice(0, 40);
  if (!Number.isInteger(row) || row < FIRST_ROW || row > 100000) return Response.json({ error: "Bad row" }, { status: 400 });
  if (result !== "Yes" && result !== "No") return Response.json({ error: "Choose Yes or No." }, { status: 400 });
  if (result === "Yes" && !date) return Response.json({ error: "Enter the date of the safety test." }, { status: 400 });
  const bad = result === "Yes" ? checkSafetyDate(date) : "";
  if (bad) return Response.json({ error: bad }, { status: 400 });
  if (!String(body.okla ?? "").trim()) return Response.json({ error: "Missing elevator" }, { status: 400 });
  try {
    const at = await requireElevatorRow(row, body.okla); // the right elevator, even if rows moved
    await recordMaint(at, result, result === "Yes" ? date : "");
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof NoSuchRow) return Response.json({ error: err.message }, { status: 404 });
    return Response.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 502 });
  }
}
