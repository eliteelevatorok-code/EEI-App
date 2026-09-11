import { readSwitches } from "@/lib/switches";
import { getPushConfig } from "@/lib/push";

export const runtime = "nodejs";

// Public, secret-guarded: lets the Make automation read the master switch so
// every route can halt when the whole system is paused. Returns "On" / "Off"
// (a string, so a Make filter can compare it directly).
async function handle(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const cfg = await getPushConfig();
  if (!cfg.runSecret || key !== cfg.runSecret) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const { master } = await readSwitches();
  return Response.json({ master: master ? "On" : "Off" });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
