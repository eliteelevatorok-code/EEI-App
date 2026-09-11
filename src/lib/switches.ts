import { readRange, writeCell } from "@/lib/google";

// The on/off switches. A master switch (in the Config tab) halts everything; a
// per-elevator switch (column AL "Active") pauses just that one. "Off" pauses;
// anything else — including blank — counts as on, so a row is never silently
// paused. The app's automated actions (invoicing, the paid reader) honor these,
// and the Make automation will check the same flags when it goes live.

const TAB = "Elevators";
const MASTER_LABEL = "masterSwitch";
const IDX = { okla: 0, building: 1, active: 37 }; // AL
const COL_ACTIVE = "AL";

const isOff = (v: string) => (v ?? "").trim().toLowerCase() === "off";

export type SwitchState = {
  master: boolean; // true = running
  elevators: { row: number; okla: string; building: string; on: boolean }[];
};

// Read the master switch and every elevator's switch in one shot.
export async function readSwitches(): Promise<SwitchState> {
  const [cfg, rows] = await Promise.all([readRange("Config!A1:B20"), readRange(`${TAB}!A2:AL`)]);
  const map = new Map(cfg.map((r) => [(r[0] ?? "").trim(), (r[1] ?? "").trim()]));
  const master = !isOff(map.get(MASTER_LABEL) ?? "On");
  const elevators: SwitchState["elevators"] = [];
  rows.forEach((r, i) => {
    const okla = (r[IDX.okla] ?? "").trim();
    if (!okla) return;
    elevators.push({
      row: 2 + i,
      okla,
      building: (r[IDX.building] ?? "").trim(),
      on: !isOff(r[IDX.active] ?? ""),
    });
  });
  return { master, elevators };
}

// The guard the automated actions ask before acting: is the master on, and
// which rows are individually paused.
export async function guards(): Promise<{ masterOn: boolean; offRows: Set<number> }> {
  const st = await readSwitches();
  return { masterOn: st.master, offRows: new Set(st.elevators.filter((e) => !e.on).map((e) => e.row)) };
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
