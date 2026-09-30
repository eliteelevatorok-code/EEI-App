import { readRange, writeCells } from "@/lib/google";

// The dashboard's private Config tab: one setting per row — name in column A,
// value in column B. Holds the phone-alert keys, the scheduler secret, the master
// switch, and the QuickBooks keys. Only the app's Google robot account can read it,
// which is why secrets live here rather than in the app's code.
const NAMES = "Config!A1:A60"; // the tab has 60 lines (enlarged 2026-09-29 — it was 20, nearly full)

// Every setting, by name.
export async function readConfig(): Promise<Map<string, string>> {
  const rows = await readRange("Config!A1:B60");
  return new Map(rows.map((r) => [(r[0] ?? "").trim(), (r[1] ?? "").trim()]));
}

// Save one setting, adding a row for it if the name isn't there yet.
export async function writeConfig(name: string, value: string): Promise<void> {
  const rows = await readRange(NAMES);
  const i = rows.findIndex((r) => (r[0] ?? "").trim() === name);
  const row = (i === -1 ? rows.length : i) + 1; // sheet rows start at 1
  await writeCells([
    ...(i === -1 ? ([[`Config!A${row}`, name]] as [string, string][]) : []),
    [`Config!B${row}`, value],
  ]);
}
