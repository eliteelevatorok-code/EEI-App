import { readSwitches, setMaster, setElevatorSwitch } from "@/lib/switches";

export const runtime = "nodejs";

// GET /api/switches → the master switch and every elevator's switch.
export async function GET() {
  try {
    return Response.json(await readSwitches());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Read failed" }, { status: 502 });
  }
}

// POST changes a switch.
//   { target: "master", on: boolean, confirm?: "STOP" }
//     - turning the master OFF requires confirm === "STOP" (accident guard).
//   { target: "elevator", row: number, on: boolean }
export async function POST(req: Request) {
  let body: { target?: string; on?: boolean; row?: number; confirm?: string };
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

    if (body.target === "elevator") {
      const row = body.row;
      if (!Number.isInteger(row) || (row as number) < 2 || (row as number) > 100000) {
        return Response.json({ error: "Bad row" }, { status: 400 });
      }
      await setElevatorSwitch(row as number, body.on);
      return Response.json({ ok: true, row, on: body.on });
    }

    return Response.json({ error: "Unknown target" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Write failed" }, { status: 502 });
  }
}
