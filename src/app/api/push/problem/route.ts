import { sendProblemAlert } from "@/lib/push";
import { rejectUnlessScheduler } from "@/lib/schedulerKey";

export const runtime = "nodejs";

// Called by the Make "daily lifecycle" automation when one step fails for one
// elevator (a bad date, a bad email address, Google busy…). Make skips that
// elevator and carries on with the rest; this tells Robert's phone which
// elevator and what went wrong, in plain words (once a day per problem).
//   POST /api/push/problem?okla=…&building=…&step=…&error=…
export async function POST(req: Request) {
  const denied = await rejectUnlessScheduler(req);
  if (denied) return denied;
  const p = new URL(req.url).searchParams;
  const get = (k: string, max: number) => (p.get(k) ?? "").trim().slice(0, max);
  const result = await sendProblemAlert(get("okla", 40), get("building", 120), get("step", 60) || "automatic step", get("error", 1000));
  return Response.json({ ok: true, ...result });
}
