"use client";

import { useClerk } from "@clerk/nextjs";
import { Button, Glass } from "@/components/ui";

export default function NotAuthorized() {
  const { signOut } = useClerk();
  return (
    <main className="rise mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <div className="text-sm font-semibold text-accent-ink">Elite Elevator Inspections</div>
        <h1 className="title mt-1">Field Reports</h1>
      </div>
      <Glass pad className="w-full">
        <h2 className="text-lg font-bold">Not authorized</h2>
        <p className="mt-2 text-[15px] text-ink-2">
          This account isn&apos;t on the approved list for the Elite Elevator Inspections (EEI) field app. If you think that&apos;s a
          mistake, contact Robert.
        </p>
        <Button full className="mt-5" onClick={() => signOut({ redirectUrl: "/sign-in" })}>
          Sign out
        </Button>
      </Glass>
    </main>
  );
}
