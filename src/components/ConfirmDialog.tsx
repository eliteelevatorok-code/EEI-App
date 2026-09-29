"use client";

import { Button, Sheet } from "@/components/ui";

// The app's one "are you sure?" step: a glass sheet that rises from the bottom
// with a title, a message, the main button and Cancel. Used for every step that
// changes the live dashboard (lifecycle edits, pausing/resuming an elevator, the
// master switch).
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
  danger?: boolean; // red main button for the "pause / stop" direction
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
    <Sheet onClose={busy ? () => {} : onCancel}>
      <h3 className="text-[21px] font-bold tracking-tight">{title}</h3>
      <div className="mt-1.5 text-[15px] text-ink-2">{children}</div>
      {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}
      <div className="mt-6 flex flex-col gap-2.5">
        <Button variant={danger ? "danger" : "primary"} full onClick={onConfirm} disabled={busy || confirmDisabled}>
          {busy && busyLabel ? busyLabel : confirmLabel}
        </Button>
        <Button variant="secondary" full onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}
