"use client";

// The app's one "are you sure?" pop-up: a dimmed screen, a card with a title and
// message, and Cancel + a main button. Used for every step that changes the live
// dashboard (lifecycle edits, pausing/resuming an elevator, the master switch).
export function ConfirmDialog({
  title,
  danger = false,
  confirmLabel,
  busyLabel,
  busy = false,
  confirmDisabled = false,
  error,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  danger?: boolean; // red styling for the "pause / stop" direction
  confirmLabel: string;
  busyLabel?: string; // shown on the main button while saving
  busy?: boolean;
  confirmDisabled?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h4 className={"text-base font-bold " + (danger ? "text-red-700" : "text-[#1F4B45]")}>{title}</h4>
        <div className="mt-2 text-sm text-stone-600">{children}</div>
        {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-lg border border-stone-300 bg-stone-50 py-3 text-sm font-bold uppercase tracking-wider text-stone-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={
              "flex-1 rounded-lg py-3 text-sm font-bold uppercase tracking-wider text-white disabled:opacity-40 " +
              (danger ? "bg-red-600" : "bg-[#1F4B45]")
            }
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
