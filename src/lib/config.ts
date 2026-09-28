import { readRange, writeCell } from "@/lib/google";

// The dashboard's private Config tab: one setting per row — name in column A,
// value in column B. Holds the phone-alert keys, the scheduler secret, the master
// switch, and the QuickBooks keys. Only the app's Google robot account can read it,
// which is why secrets live here rather than in the app's code.
const NAMES = "Config!A1:A30";

// Every setting, by name.
export async function readConfig(): Promise<Map<string, string>> {
  const rows = await readRange("Config!A1:B30");
  return new Map(rows.map((r) => [(r[0] ?? "").trim(), (r[1] ?? "").trim()]));
}

// Save one setting, adding a row for it if the name isn't there yet.
export async function writeConfig(name: string, value: string): Promise<void> {
  const rows = await readRange(NAMES);
  let i = rows.findIndex((r) => (r[0] ?? "").trim() === name);
  if (i === -1) {
    i = rows.length;
    await writeCell(`Config!A${i + 1}`, name);
  }
  await writeCell(`Config!B${i + 1}`, value);
}
