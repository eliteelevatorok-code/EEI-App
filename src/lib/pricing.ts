// EEI's confirmed customer price = the State Charges, set by elevator type +
// floor count. Robert shouldn't have to remember these — the app computes them.
//   Escalator / Moving Walk .............. $250
//   Wheelchair / Platform Lift ........... $200
//   Elevator, 2–4 floors ................. $200
//   Elevator, 5–10 floors ................ $250
//   Elevator, 11–15 floors ............... $300
//   Elevator, over 15 floors ............. $300 + $10 per floor beyond 15
export function computePrice(type: string, floors: number): number | null {
  if (!type) return null;
  if (/escalator|moving walk/i.test(type)) return 250;
  if (/wheelchair|platform lift/i.test(type)) return 200;
  if (/elevator/i.test(type)) {
    if (!floors) return null; // need floors to price an elevator
    if (floors <= 4) return 200;
    if (floors <= 10) return 250;
    if (floors <= 15) return 300;
    return 300 + (floors - 15) * 10;
  }
  return null;
}

export function formatPrice(n: number | null): string {
  return n == null ? "—" : `$${n}`;
}
