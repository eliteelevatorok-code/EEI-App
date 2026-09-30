import { sendAlert } from "@/lib/push";

export const runtime = "nodejs";

// Settings → "Send me a test alert" (login required). Buzzes every signed-up
// phone right now — works even with the master switch off, because it's a check
// that alerts reach the phones, not a real alert. Answers how many phones got it.
export async function POST() {
  const result = await sendAlert(
    "Test alert",
    "Alerts are working on this phone.",
    "/?tab=settings",
    "eei-test",
  );
  return Response.json({ ok: true, ...result });
}
