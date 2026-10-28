import { appendRow, readRange, writeCells } from "@/lib/google";
import { isSealed, seal, unseal } from "@/lib/secretBox";

// The dashboard's private Config tab: one setting per row — name in column A,
// value in column B. Holds the phone-alert keys, the scheduler secret, the master
// switch, and the QuickBooks keys. Only the app's Google robot account can read it,
// which is why secrets live here rather than in the app's code.
const NAMES = "Config!A1:A60"; // the tab has 60 lines (enlarged 2026-09-29 — it was 20, nearly full)

// Settings stored scrambled (secretBox.ts), so they're never readable in the
// sheet itself (Robert, 2026-10-28). Saved scrambled; read back as plain text by
// readConfig, so the rest of the app never sees the difference. One that's still
// plain (saved before this) is scrambled in place the first time it's read.
// pushRunSecret stays plain on purpose: the Make scenarios hold it in plain text
// anyway (they send it), and scrambling it would gain nothing.
// The QuickBooks sign-in (qbRefreshToken, qbRealRefreshToken, qbRealmId,
// sandboxRealmId) was already saved scrambled by quickbooks.ts.
const SECRET = new Set(["vapidPrivate", "devClientSecret", "qbClientSecret", "googleDriveToken"]);

// Every setting, by name (scrambled ones already unscrambled).
export async function readConfig(): Promise<Map<string, string>> {
  const rows = await readRange("Config!A1:B60");
  const map = new Map<string, string>();
  const plainSecrets: string[] = [];
  for (const r of rows) {
    const name = (r[0] ?? "").trim();
    const value = (r[1] ?? "").trim();
    if (SECRET.has(name) && value && !isSealed(value)) plainSecrets.push(name);
    let open = value;
    try {
      open = unseal(value);
    } catch {
      // Can't be opened (the robot key changed?): hand back the stored value, so
      // the caller's own check fails loudly (e.g. QuickBooks says "sign in again").
    }
    map.set(name, open);
  }
  // Scramble any secret that's still plain. A failure here never blocks the read.
  for (const name of plainSecrets) await writeConfig(name, map.get(name) ?? "").catch((e) => console.error(`[config] couldn't scramble ${name}:`, e));
  return map;
}

// Save one setting, adding a row for it if the name isn't there yet. Secrets
// (SECRET above) are saved scrambled.
export async function writeConfig(name: string, value: string): Promise<void> {
  const stored = SECRET.has(name) && value && !isSealed(value) ? seal(value) : value;
  const rows = await readRange(NAMES);
  const i = rows.findIndex((r) => (r[0] ?? "").trim() === name);
  // A new setting is appended (Google picks the row), so two new settings saved
  // at the same moment can't both land on — and overwrite — the same row.
  if (i === -1) await appendRow("Config!A:B", [name, stored]);
  else await writeCells([[`Config!B${i + 1}`, stored]]); // sheet rows start at 1
}
