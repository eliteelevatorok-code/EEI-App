import { isMasterOn } from "@/lib/switches";
import { rejectUnlessScheduler } from "@/lib/schedulerKey";

export const runtime = "nodejs";

// Called by the Make "daily lifecycle" scenario (module #101) before its routes
// run. Every route only fires when this says "On" — so pausing the master
// switch in the app halts all automatic steps. Returns "On"/"Off" as text so a
// Make filter can compare it directly.
async function handle(req: Request) {
  const denied = await rejectUnlessScheduler(req);
  if (denied) return denied;
  return Response.json({ master: (await isMasterOn()) ? "On" : "Off" });
}

export const GET = handle;
export const POST = handle;
