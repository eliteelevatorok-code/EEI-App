import { readConfig, writeConfig } from "@/lib/config";
import { FIRST_ROW, cell, readRows, writeRow } from "@/lib/sheet";

// The on/off switches.
//   Master switch — Config tab, row labelled "masterSwitch". Off halts everything.
//   Per-elevator  — the Elevators "Active" column. Off pauses just that elevator.
// Only the word "Off" pauses; anything else (including blank) counts as on, so a
// row can never be paused by accident. Checked by the Make automation (via
// /api/switches/master and each route's filter), the billing steps in
// src/lib/invoice.ts, and the phone alerts in src/lib/push.ts.

const MASTER_LABEL = "masterSwitch";
const isOff = (v: string | undefined) => (v ?? "").trim().toLowerCase() === "off";

// Is this Elevators row (already read from the sheet) switched off?
export const isRowPaused = (row: string[]) => isOff(cell(row, "active"));

// Just the master switch — one small read of the Config tab. (Missing = on.)
export async function isMasterOn(): Promise<boolean> {
  return !isOff((await readConfig()).get(MASTER_LABEL));
}

export type SwitchState = {
  master: boolean; // true = running
  elevators: { row: number; okla: string; building: string; on: boolean }[];
};

// The master switch plus every elevator's switch (for the app's switch screens).
export async function readSwitches(): Promise<SwitchState> {
  const [master, rows] = await Promise.all([isMasterOn(), readRows()]);
  const elevators: SwitchState["elevators"] = [];
  rows.forEach((r, i) => {
    const okla = cell(r, "okla");
    if (okla) elevators.push({ row: FIRST_ROW + i, okla, building: cell(r, "building"), on: !isRowPaused(r) });
  });
  return { master, elevators };
}

// Flip the master switch.
export async function setMaster(on: boolean): Promise<void> {
  await writeConfig(MASTER_LABEL, on ? "On" : "Off");
}

// Flip one elevator's switch.
export async function setElevatorSwitch(row: number, on: boolean): Promise<void> {
  await writeRow(row, { active: on ? "On" : "Off" });
}
