import { findForMaint, recordMaint } from "@/lib/maint";
import { checkSafetyDate } from "@/lib/records";

export const runtime = "nodejs";

// GET /api/maint?t=<token> → { building, okla, maintCo, already... } so the page
// can greet the maintenance company with the building. Nothing without the token.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const el = await findForMaint(token);
  if (!el) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({
    building: el.building,
    okla: el.okla,
    maintCo: el.maintCo,
    alreadyResult: el.alreadyResult,
    alreadyDate: el.alreadyDate,
  });
}

// POST { token, result, date } → save the two answers into the row.
// result = "Yes" / "No" (a passing safety test in the last 12 months); the date
// is needed only for "Yes".
export async function POST(req: Request) {
  let body: { token?: string; result?: string; date?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const result = String(body.result ?? "").trim();
  const date = String(body.date ?? "").trim();
  if (result !== "Yes" && result !== "No") {
    return Response.json({ error: "Please choose Yes or No." }, { status: 400 });
  }
  if (result === "Yes" && !date) {
    return Response.json({ error: "Please enter the date of the safety test." }, { status: 400 });
  }
  const bad = result === "Yes" ? checkSafetyDate(date) : "";
  if (bad) return Response.json({ error: bad }, { status: 400 });
  const el = await findForMaint(String(body.token ?? ""));
  if (!el) return Response.json({ error: "This link isn't recognized." }, { status: 404 });
  try {
    await recordMaint(el.row, result, result === "Yes" ? date : "");
  } catch {
    // Public page: never show outsiders the internal error.
    return Response.json({ error: "Couldn't save just now — please try again in a minute." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
