import { isMasterOn } from "@/lib/switches";
import { rejectUnlessScheduler } from "@/lib/schedulerKey";
import { fillMissingTokens } from "@/lib/sheet";

export const runtime = "nodejs";

// Called by the Make "daily lifecycle" scenario (module #101) before its routes
// run. Every route only fires when this says "On" — so pausing the master
// switch in the app halts all automatic steps. Returns "On"/"Off" as text so a
// Make filter can compare it directly. Also fills missing link tokens first
// (rows typed straight into the sheet).
async function handle(req: Request) {
  const denied = await rejectUnlessScheduler(req);
  if (denied) return denied;
  // Give any hand-typed elevator its link token first (see fillMissingTokens).
  // A failure here must never stop the run — it only delays that elevator's emails.
  const filled = await fillMissingTokens().catch((e) => {
    console.error("[tokens] couldn't fill missing link tokens:", e);
    return 0;
  });
  return Response.json({ master: (await isMasterOn()) ? "On" : "Off", filled });
}

export const GET = handle;
export const POST = handle;
