import { cell, findByToken, writeRow } from "@/lib/sheet";

// Customer PO capture. The quote email's "Submit your PO number" link opens
// /po?t=<token>; the token is the only thing that identifies the elevator.

// invoiced: the invoice has gone out (it carries the PO) — after that the PO can't be changed from the link.
export type POElevator = { row: number; okla: string; building: string; account: string; alreadyPO: string; invoiced: boolean };

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
  };
}

// Save the PO number (and file link, if one was attached) and mark the PO stage
// "Received" so the lifecycle moves on.
export async function recordPO(row: number, poNumber: string, fileLink?: string): Promise<void> {
  await writeRow(row, { poNumber, ...(fileLink ? { poFile: fileLink } : {}), po: "Received" });
}
