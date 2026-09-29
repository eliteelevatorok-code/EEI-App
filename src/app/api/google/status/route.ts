import { driveConnected } from "@/lib/google";

export const runtime = "nodejs";

// Settings → Google Drive: is the app still able to save reports to Drive?
export async function GET() {
  return Response.json({ connected: await driveConnected() });
}
