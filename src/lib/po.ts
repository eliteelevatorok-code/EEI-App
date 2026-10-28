import { cell, findByToken, writeRow } from "@/lib/sheet";

// Customer PO capture. The quote email's "Submit your PO number" link opens
// /po?t=<token>; the token is the only thing that identifies the elevator.

// invoiced: the invoice has gone out (it carries the PO) — after that the PO can't be changed from the link.
// open: this cycle's quote email has gone out. The link code never changes, so a
// link from last year's quote still finds the elevator — but after the yearly
// reset it must not drop an old PO into the new cycle.
export type POElevator = { row: number; okla: string; building: string; account: string; alreadyPO: string; invoiced: boolean; open: boolean };

export async function findForPO(token: string): Promise<POElevator | null> {
  const hit = await findByToken(token);
  if (!hit) return null;
  const r = hit.cells;
  return {
    row: hit.row,
    okla: cell(r, "okla"),
    building: cell(r, "building"),
    account: cell(r, "account") || "Unassigned",
    alreadyPO: cell(r, "poNumber"),
    invoiced: cell(r, "invoice") === "Sent",
    open: cell(r, "quote") === "Sent",
  };
}

// Save the PO number (and file link, if one was attached) and mark the PO stage
// "Received" so the lifecycle moves on.
export async function recordPO(row: number, poNumber: string, fileLink?: string): Promise<void> {
  await writeRow(row, { poNumber, ...(fileLink ? { poFile: fileLink } : {}), po: "Received" });
}
