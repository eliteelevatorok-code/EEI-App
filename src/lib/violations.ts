// Transcribed exactly from Robert's list (EEI-HANDOFF section 9). Do not add,
// reword, or "complete" these. Only what was photographed.
export const VHEAD =
  "STEP I — Machine room inspection. This is where test, maintenance, monthly firefighter documents are located also elevator drive unit serial number and ID number.";

export const VIOLATIONS: string[] = [
  "Access keys shall be provided -- 17.1-8.6.11.3,-MR",
  "Remove blockage to access machinery space, machine room -- 17.1-2.7.3,-MR",
  "Machine Room Doors must be kept locked and closed -- 17.1-8.6.4.8.4,-MR",
  "Machine room doors must be self-closing, spring type self-locking door knob -- 17.1-2.7.3.4.1,-MR",
  "Provide permanent means to access elevator machine room -- 17.3-2.2.2,-MR",
  "Provide machine rooms to be ventilated natural or mechanical -- 17.3-2.2.4,-MR",
  "Install light switch located at point of entry -- 17.1-2.7.9.1,-MR",
  "Machine room must have lighting minimum illumination (19fc) -- 17.1-2.7.9.1,-MR",
  "Machine room lighting required to be permanent -- 17.3-2.2.3,-MR",
  "Machine numbering required for more than one elevator in building -- 17.1-2.29.1,-MR",
  "Elevator light disconnect must be installed -- NEC 620.22 / 53,-MR",
  "Mainline disconnect must be installed within sight of elevator -- NEC620.51,-MR",
  "Multiple power source warning sign installed on mainline disconnect -- NEC620.52,-MR",
  "Provide power supply line disconnect means at each elevator motor, or motor generator set and controller equipment -- 17.3-3.10.5,-MR",
  "Disconnect must be lockable -- NEC620.51,-MR",
  "Install ground fault circuit interrupter (GFCI) in pit and machine room -- NEC620.85,-MR",
  "Install protective covering on non-elevator related piping in machinery room -- 17.3-2.2.5,-MR",
  "All elevator equipment shall be protected from weather -- 17.3-2.2.6,-MR",
  "Provide written maintenance control program -- 17.1-8.6.1.2.1,-MR",
  "All maintenance records shall be maintained to accurately reflect the frequency of service and items serviced -- 17.1-8.6.1.4.1,-MR",
  "Maintenance record availability shall be kept on site -- 17.1-8.6.1.4.2,-MR",
  "Oil Log shall be maintained and available of hydraulic fluid when added to system -- 17.1-8.6.5.7,-MR",
  "Provide means to check minimum and maximum hydraulic oil level -- 17.1-8.6.5.4,-MR",
  "Provide or maintain monthly firefighter test log -- 17.1-8.6.11.1,-MR",
  "Elevator shall conform to the requirements of firefighter service Phase I & II -- 17.3-3.11.3,-",
  "Electrical schematic shall be available -- 17.1-8.6.1.6.3a,-MR",
  "Clean inside elevator controller -- 17.1-8.6.1.6.3b,-MR",
  "Remove temporary wiring blocks from controller -- 17.1-8.6.1.6.3c,-MR",
  "Jumper Wires not to be stored in controller -- 17.1-8.6.1.6.3d,-MR",
  "\"ABC\" fire extinguisher required in machine room located near access door -- 17.1-8.6.1.6.5,-MR",
  "Periodic test tags shall be installed -- 17.1-8.6.1.7.3,-DOC",
  "Relief valve shall be sealed -- 17.1-8.6.5.9,-MR",
  "Relief valve shall not exceed 150% of working pressure -- 17.1-8.6.5.14,-MR",
  "Provide test documentation on site -- 17.1-8.11.1.1.1,-DOC",
  "Witness inspector must provide signed test forms -- 17.1-8.11.1.1.2a,-DOC",
  "Provide glass back elevators and hoistway cleaning procedure -- 17.1-8.6.11.4,-DOC",
  "Provide written emergency evacuation procedure from a stalled elevator -- 17.1-8.6.11.5,-DOC",
  "Provide escalator start up procedure -- 17.1-8.6.11.6,-DOC",
  "Periodic (1) year test electric elevator -- 17.1-8.6.4.19,-DOC",
  "Five (5) year test electric elevator -- 17.1-8.6.4.19.7,-DOC",
  "Periodic hydraulic elevator test -- 17.1-8.6.5.,-DOC",
  "Standby Power where provided elevator operation shall be tested -- 17.1-8.6.4.19.7,-DOC",
  "Install code data plate -- 17.1-8.9,-MR",
  "Replace a worn belt, and/or chain (entire set must be replaced) -- 17.1-8.6.3.5,-MR",
];

export type ParsedViolation = { text: string; code: string };

// Split "text -- code,-TAG" into a readable label and its code reference.
export function parseViolation(raw: string): ParsedViolation {
  const idx = raw.lastIndexOf(" -- ");
  if (idx === -1) return { text: raw, code: "" };
  return { text: raw.slice(0, idx).trim(), code: raw.slice(idx + 4).trim() };
}
