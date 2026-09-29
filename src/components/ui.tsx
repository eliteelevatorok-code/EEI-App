"use client";

import { flushSync } from "react-dom";

// The app's building blocks. Each one is the style guide (src/app/globals.css)
// turned into a React piece, so screens are assembled from these instead of
// styling things by hand. New look? Change it in globals.css; new piece? add it here.

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// Change screens with a soft crossfade/glide (Chrome's View Transitions). Falls
// back to an instant change where the browser can't animate it.
// (Skipped when the page isn't on screen — the browser cancels the animation
// then; the change itself still happens either way.)
// `after` runs once the new screen is on the page (e.g. to restore its scroll spot).
export function go(update: () => void, after?: () => void) {
  type VT = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => VT };
  const run = () => {
    flushSync(update);
    after?.();
  };
  if (!doc.startViewTransition || document.visibilityState !== "visible") return run();
  const t = doc.startViewTransition(run);
  // A cancelled animation isn't an error worth reporting.
  for (const p of [t.ready, t.finished, t.updateCallbackDone]) p.catch(() => {});
}

// A light tap on Android phones for moments that matter (a save, a switch).
export function buzz() {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* not supported */
  }
}

/* ---- Layout ---------------------------------------------------------------- */

// One screen's column: centered, phone-width, content rises in on open.
export function Screen({ children, bottomSpace = false }: { children: React.ReactNode; bottomSpace?: boolean }) {
  return (
    <div className={cx("rise mx-auto max-w-md px-5 pt-5", bottomSpace ? "pb-36" : "pb-16")}>{children}</div>
  );
}

// Back link on the left, optional content (e.g. Settings) on the right.
export function TopBar({ back, right }: { back?: { label: string; onClick: () => void }; right?: React.ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between">
      {back ? (
        <button onClick={back.onClick} className="btn-quiet flex items-center gap-0.5 text-base">
          <Chevron dir="left" />
          {back.label}
        </button>
      ) : (
        <span />
      )}
      {right}
    </div>
  );
}

// Small gray line above a big bold title.
export function Title({ eyebrow, children }: { eyebrow?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1 className="title mt-1">{children}</h1>
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="section-label">{children}</h2>;
}

// A frosted panel. `pad` adds the standard inner spacing.
export function Glass({
  children,
  pad = false,
  className,
}: {
  children: React.ReactNode;
  pad?: boolean;
  className?: string;
}) {
  return <section className={cx("glass", pad && "card", className)}>{children}</section>;
}

// A glass panel holding rows with hairlines between them.
export function List({ children }: { children: React.ReactNode }) {
  return <div className="glass list overflow-hidden">{children}</div>;
}

// A label + value row inside a List.
export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row justify-between text-[15px]">
      <span className="text-ink-2">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

/* ---- Controls ---------------------------------------------------------------- */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "soft" | "danger" | "quiet";
  full?: boolean;
};
export function Button({ variant = "primary", full, className, ...rest }: BtnProps) {
  return <button {...rest} className={cx("btn", `btn-${variant}`, full && "w-full", className)} />;
}

export function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)} className={cx("chip", o === value && "chip-on")}>
          {o}
        </button>
      ))}
    </div>
  );
}

// Two-choice switcher with a sliding thumb.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  const i = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div className="segmented">
      <div className="segmented-thumb" style={{ transform: `translateX(${i * 100}%)` }} />
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cx(
            "relative z-10 flex-1 rounded-full py-2 text-sm font-semibold transition-colors",
            v === value ? "text-ink" : "text-ink-2",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={cx("toggle", on && "toggle-on")} />;
}

// Label above a form field.
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block last:mb-0">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

/* ---- Status ---------------------------------------------------------------- */

export function Pill({ tone = "gray", dot, children }: { tone?: "gray" | "green" | "red"; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className={cx("pill", tone === "green" && "pill-green", tone === "red" && "pill-red")}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

// Days until a due date → colored dot + words. Overdue red, within 30 days
// amber, within the "due soon" window green, otherwise quiet gray.
export function DueDot({ days, fallback }: { days: number | null; fallback: string }) {
  const tone =
    days === null ? "text-ink-3" : days < 0 ? "text-danger" : days <= 30 ? "text-warn" : days <= 60 ? "text-accent-ink" : "text-ink-3";
  const text =
    days === null ? fallback || "No date" : days < 0 ? `${-days}d overdue` : days === 0 ? "Due today" : `in ${days} days`;
  return (
    <span className={cx("flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold", tone)}>
      <span className="dot" />
      {text}
    </span>
  );
}

/* ---- Tab bar ------------------------------------------------------------------- */

export type TabItem<T extends string> = { key: T; label: string; icon: React.ReactNode; badge?: number };

// The glass bar at the bottom for moving between the app's main places.
export function TabBar<T extends string>({ tabs, value, onChange }: { tabs: TabItem<T>[]; value: T; onChange: (t: T) => void }) {
  return (
    <nav className="tab-bar glass-strong" aria-label="Main">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cx("tab", t.key === value && "tab-on")}
          aria-current={t.key === value ? "page" : undefined}
        >
          <span className="relative">
            {t.icon}
            {t.badge ? <span className="tab-badge">{t.badge > 9 ? "9+" : t.badge}</span> : null}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

const icon = (d: React.ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
export const TodayIcon = () => icon(<><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.7 2.7L16.5 9.5" /></>);
export const ElevatorsIcon = () => icon(<><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="m9.5 9 2.5-2.5L14.5 9M9.5 15l2.5 2.5 2.5-2.5" /></>);
export const MoneyIcon = () => icon(<><rect x="3" y="6" width="18" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.5" /><path d="M6.5 9.5v5M17.5 9.5v5" /></>);
export const SettingsIcon = () => icon(<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" /></>);

/* ---- Public pages (opened by customers / maintenance companies from email) ---- */

// The frame for /po, /maint and /pay: company name, a title, then one glass card.
export function PublicPage({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="rise mx-auto max-w-md px-5 pb-16 pt-10">
      <div className="text-sm font-semibold text-accent-ink">Elite Elevator Inspections</div>
      {title && <h1 className="title mt-2">{title}</h1>}
      {subtitle && <p className="mt-2 text-[15px] text-ink-2">{subtitle}</p>}
      <Glass pad className="mt-6">
        {children}
      </Glass>
    </main>
  );
}

// A short message inside a card (e.g. "we already have PO 123 on file").
export function Notice({ tone = "gray", children }: { tone?: "gray" | "green" | "warn"; children: React.ReactNode }) {
  const look = tone === "green" ? "bg-accent-soft text-accent-ink" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-fill text-ink-2";
  return <p className={cx("mb-4 rounded-field px-3.5 py-3 text-sm", look)}>{children}</p>;
}

/* ---- Sheets ---------------------------------------------------------------- */

// A panel that rises from the bottom over a dimmed screen. Tap the dim to close.
export function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet glass-strong" role="dialog" aria-modal="true">
        <div className="sheet-grab" />
        {children}
      </div>
    </>
  );
}

/* ---- Icons ---------------------------------------------------------------- */

export function Chevron({ dir = "right" }: { dir?: "left" | "right" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d={dir === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" aria-hidden>
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}
