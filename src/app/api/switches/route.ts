import { FIRST_ROW, NoSuchRow, requireElevatorRow, writeRow } from "@/lib/sheet";
import { isMasterOn, readSwitches, setMaster, setElevatorSwitch } from "@/lib/switches";

export const runtime = "nodejs";

// GET /api/switches → the master switch and every elevator's switch.
// GET /api/switches?only=master → just { master } (one small read — for Settings).
export async function GET(req: Request) {
  try {
    if (new URL(req.url).searchParams.get("only") === "master") return Response.json({ master: await isMasterOn() });
    return Response.json(await readSwitches());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Read failed" }, { status: 502 });
  }
}

// POST changes a switch.
//   { target: "master", on: boolean, confirm?: "STOP" }
//     - turning the master OFF requires confirm === "STOP" (accident guard).
//   { target: "elevator", row: number, on: boolean }
//   { target: "quotePO", row: number, okla, on: boolean } — the elevator's billing
//     type (col Q): on = "Quote to PO to invoice" (price quote email + purchase
//     order before the visit), off = "Invoice only" (no quote, no PO — those
//     steps disappear from its lifecycle and the quote email never goes out).
export async function POST(req: Request) {
  let body: { target?: string; on?: boolean; row?: number; okla?: string; confirm?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.on !== "boolean") {
    return Response.json({ error: "Missing on/off value" }, { status: 400 });
  }

  try {
    if (body.target === "master") {
      // Turning everything off is the dangerous one — require the typed word.
      if (body.on === false && body.confirm !== "STOP") {
        return Response.json({ error: "Master shut-off needs confirm:\"STOP\"" }, { status: 400 });
      }
      await setMaster(body.on);
      return Response.json({ ok: true, master: body.on });
    }

    if (body.target === "elevator" || body.target === "quotePO") {
      const row = body.row;
      if (!Number.isInteger(row) || (row as number) < FIRST_ROW || (row as number) > 100000) {
        return Response.json({ error: "Bad row" }, { status: 400 });
      }
      // The OK # is required so a moved row can never switch the wrong elevator.
      if (!String(body.okla ?? "").trim()) return Response.json({ error: "Missing elevator" }, { status: 400 });
      const at = await requireElevatorRow(row as number, body.okla); // the right elevator, even if rows moved
      if (body.target === "quotePO") {
        await writeRow(at, { moneyPath: body.on ? "Quote to PO to invoice" : "Invoice only" });
        return Response.json({ ok: true, row: at, on: body.on });
      }
      await setElevatorSwitch(at, body.on);
      return Response.json({ ok: true, row: at, on: body.on });
    }

    return Response.json({ error: "Unknown target" }, { status: 400 });
  } catch (err) {
    if (err instanceof NoSuchRow) return Response.json({ error: err.message }, { status: 404 });
    return Response.json({ error: err instanceof Error ? err.message : "Write failed" }, { status: 502 });
  }
}
