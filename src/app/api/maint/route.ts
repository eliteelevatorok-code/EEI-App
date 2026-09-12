import { findByToken, recordMaint } from "@/lib/maint";

export const runtime = "nodejs";

// GET /api/maint?t=<token> → { building, okla, maintCo, already... } so the page
// can greet the maintenance company with the building. Nothing without the token.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const el = await findByToken(token);
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
export async function POST(req: Request) {
  let body: { token?: string; result?: string; date?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const result = String(body.result ?? "").trim();
  const date = String(body.date ?? "").trim();
  if (result !== "Pass" && result !== "Fail") {
    return Response.json({ error: "Please choose Pass or Fail." }, { status: 400 });
  }
  if (!date) {
    return Response.json({ error: "Please enter the date it was last inspected." }, { status: 400 });
  }
  const el = await findByToken(String(body.token ?? ""));
  if (!el) return Response.json({ error: "This link isn't recognized." }, { status: 404 });
  try {
    await recordMaint(el.row, result, date);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return Response.json({ error: message }, { status: 502 });
  }
  return Response.json({ ok: true });
}
