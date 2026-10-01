import { qbStatus } from "@/lib/quickbooks";

export const runtime = "nodejs";

// Settings → QuickBooks: billing on the real company yet? Production keys in Config?
export async function GET() {
  return Response.json(await qbStatus());
}
