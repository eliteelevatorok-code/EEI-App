// How finished inspection reports are named in Google Drive (Robert's format):
//
//   "Lawton City: Oct 9, 2026 (TV Civic center).pdf"
//   [company]: [date inspected] ([elevator name, or its OK # if it has none])
//
// The date is written out ("Oct 9, 2026", not 10/9/2026) because a slash can't
// be in a file name once it's downloaded. The automation only emails a report
// whose date matches this visit's trip day (src/lib/report.ts), so the date is
// read back from the name — both this format and the old one
// ("report-990001-10-9-2026.pdf") are understood.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Nothing that would break a file name or a heading; tidy spaces; keep it sane.
const clean = (s: string, max: number) =>
  s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// dateText is M/D/YYYY (the app's date format).
export function reportFileName(account: string, dateText: string, building: string, okla: string): string {
  const m = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const date = m ? `${MONTHS[+m[1] - 1]} ${+m[2]}, ${m[3]}` : clean(dateText, 20);
  const company = clean(account, 80) || "No company";
  const elevator = clean(building, 80) || `OK# ${clean(okla, 30) || "unknown"}`;
  return `${company}: ${date} (${elevator}).pdf`;
}

// The inspection date in a report's file name, or null if it can't be read.
export function reportDateFromName(name: string): { month: number; day: number; year: number } | null {
  // New: "…: Oct 9, 2026 (…).pdf" — the last ": Mon D, YYYY (" in the name.
  const all = [...name.matchAll(/: ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) \(/g)];
  const n = all[all.length - 1];
  if (n) {
    const month = MONTHS.indexOf(n[1]) + 1;
    if (month) return { month, day: +n[2], year: +n[3] };
  }
  // Old: "report-990001-10-9-2026.pdf"
  const o = name.match(/-(\d{1,2})-(\d{1,2})-(\d{4})\.pdf$/);
  return o ? { month: +o[1], day: +o[2], year: +o[3] } : null;
}

// A Content-Disposition header that carries any name safely (accents, dashes…).
export function dispositionFor(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "-").replace(/["\\]/g, "");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
