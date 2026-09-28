import { readRange, writeCell } from "@/lib/google";

// The on/off switches.
//   Master switch — Config tab, row labelled "masterSwitch". Off halts everything.
//   Per-elevator  — Elevators col AL "Active". Off pauses just that elevator.
// Only the word "Off" pauses; anything else (including blank) counts as on, so a
// row can never be paused by accident. Checked by the Make automation (via
// /api/switches/master and each route's filter), the billing steps in
// src/lib/invoice.ts, and the phone alerts in src/lib/push.ts.

const TAB = "Elevators";
const MASTER_LABEL = "masterSwitch";
const IDX = { okla: 0, building: 1, active: 37 }; // AL
const COL_ACTIVE = "AL";

const isOff = (v: string | undefined) => (v ?? "").trim().toLowerCase() === "off";

// Is this Elevators row (already read, columns A..AL) switched off?
export const isRowPaused = (row: string[]) => isOff(row[IDX.active]);

// Master switch value out of the Config tab's rows (label in A, value in B).
const masterFrom = (cfg: string[][]) => !isOff(cfg.find((r) => (r[0] ?? "").trim() === MASTER_LABEL)?.[1] ?? "On");

// Just the master switch — one small read of the Config tab.
export async function isMasterOn(): Promise<boolean> {
  return masterFrom(await readRange("Config!A1:B20"));
}

export type SwitchState = {
  master: boolean; // true = running
  elevators: { row: number; okla: string; building: string; on: boolean }[];
};

// The master switch plus every elevator's switch (for the app's switch screens).
export async function readSwitches(): Promise<SwitchState> {
  const [cfg, rows] = await Promise.all([readRange("Config!A1:B20"), readRange(`${TAB}!A2:AL`)]);
  const elevators: SwitchState["elevators"] = [];
  rows.forEach((r, i) => {
    const okla = (r[IDX.okla] ?? "").trim();
    if (okla) elevators.push({ row: 2 + i, okla, building: (r[IDX.building] ?? "").trim(), on: !isRowPaused(r) });
  });
  return { master: masterFrom(cfg), elevators };
}

// Flip the master switch. Finds its Config row (creating it if missing).
export async function setMaster(on: boolean): Promise<void> {
  const rows = await readRange("Config!A1:A20");
  let i = rows.findIndex((r) => (r[0] ?? "").trim() === MASTER_LABEL);
  if (i === -1) {
    i = rows.length;
    await writeCell(`Config!A${i + 1}`, MASTER_LABEL);
  }
  await writeCell(`Config!B${i + 1}`, on ? "On" : "Off");
}

// Flip one elevator's switch.
export async function setElevatorSwitch(row: number, on: boolean): Promise<void> {
  await writeCell(`${TAB}!${COL_ACTIVE}${row}`, on ? "On" : "Off");
}
