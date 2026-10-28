import type { AddedViolation } from "@/lib/data";

// The state form's 36 numbered lines (8 on page 1, 28 on page 2): each has a type
// box (V1…, R1…, C1…) and a line for the text. Shared by the report screen (to
// count lines) and the PDF filler, so both always agree.
export const FORM_LINES = 36;
export type FormLine = { tag: string; text: string }; // tag "" = the rest of the line above

type Lines = { added: AddedViolation[]; recommendations?: string[]; comments?: string[] };

// What fits on one line: the form prints Helvetica at 8 pt on a line about 561 pt
// wide. Longer text used to run off the edge and be lost (Robert, 2026-10-28), so
// it now carries on to the next line(s), with no type box of its own.
const LINE_PT = 550;
const SIZE_PT = 8;
// Helvetica's letter widths (per 1000 pt of size) for the printable characters
// space…~; anything else counts as a wide letter.
const W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278,
  278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556,
  556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const width = (s: string) => [...s].reduce((n, ch) => n + (W[ch.charCodeAt(0) - 32] ?? 1015), 0) * (SIZE_PT / 1000);

// Split text into pieces that each fit on one line — at spaces where possible.
export function wrap(text: string): string[] {
  if (width(text) <= LINE_PT) return [text]; // fits: kept exactly as is (a list item's own wording)
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (width(next) <= LINE_PT) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    // A single "word" too long for a line is cut wherever it runs out of room.
    line = "";
    for (const ch of word) {
      if (width(line + ch) > LINE_PT) {
        out.push(line);
        line = "";
      }
      line += ch;
    }
  }
  if (line) out.push(line);
  return out;
}

// Every line the form gets, in order: each violation with its own comment right
// under it, then the recommendations, then the comments.
export function formLines(r: Lines): { lines: FormLine[]; v: number; rec: number; com: number } {
  const lines: FormLine[] = [];
  let v = 0, rec = 0, com = 0;
  const add = (tag: string, text: string) => wrap(text).forEach((t, i) => lines.push({ tag: i ? "" : tag, text: t }));
  const comment = (t: string) => t.trim() && add(`C${++com}`, t.trim());
  for (const a of r.added) {
    // Older drafts could mark a list item as a recommendation or comment.
    if (a.kind === "R") add(`R${++rec}`, a.raw);
    else if (a.kind === "C") comment(a.raw);
    else add(`V${++v}`, a.raw);
    comment(a.comment);
  }
  for (const t of r.recommendations ?? []) if (t.trim()) add(`R${++rec}`, t.trim());
  for (const t of r.comments ?? []) comment(t);
  return { lines, v, rec, com };
}
