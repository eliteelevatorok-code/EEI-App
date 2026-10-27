import { isMasterOn } from "@/lib/switches";
import { rejectUnlessScheduler } from "@/lib/schedulerKey";
import { fillMissingTokens } from "@/lib/sheet";
import { fastTrackDue, isNormalCheck } from "@/lib/tick";

export const runtime = "nodejs";

// Called by the Make "daily lifecycle" scenario (module #101) first thing on
// every check (every 15 minutes). Every route only fires when this says "On" —
// so pausing the master switch in the app halts all automatic steps. Also says
// whether this check reads the dashboard at all (run) and whether it does the
// normal hourly work (normal) — see src/lib/tick.ts. Text values ("On"/"Off",
// "Yes"/"No") so Make filters can compare them directly. Also fills missing
// link tokens first (rows typed straight into the sheet).
async function handle(req: Request) {
  const denied = await rejectUnlessScheduler(req);
  if (denied) return denied;
  // Give any hand-typed elevator its link token first (see fillMissingTokens).
  // A failure here must never stop the run — it only delays that elevator's emails.
  const filled = await fillMissingTokens().catch((e) => {
    console.error("[tokens] couldn't fill missing link tokens:", e);
    return 0;
  });
  const master = (await isMasterOn()) ? "On" : "Off";
  const normal = isNormalCheck();
  // Only look for a due fast track when this isn't already an hourly check.
  const fast = master === "On" && !normal ? await fastTrackDue().catch(() => false) : false;
  const yes = (b: boolean) => (b ? "Yes" : "No");
  return Response.json({ master, filled, normal: yes(normal), run: yes(master === "On" && (normal || fast)) });
}

export const GET = handle;
export const POST = handle;
