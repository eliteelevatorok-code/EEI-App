import { loadRoster } from "@/lib/roster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always read the live dashboard

// GET the live elevator roster from the dashboard, grouped by account.
export async function GET() {
  try {
    const accounts = await loadRoster();
    return Response.json({ accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read the dashboard";
    return Response.json({ error: message }, { status: 502 });
  }
}
