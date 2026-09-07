"use client";

import { useClerk } from "@clerk/nextjs";

export default function NotAuthorized() {
  const { signOut } = useClerk();
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <div className="text-xl font-extrabold tracking-wide text-[#1F4B45]">ELITE ELEVATOR</div>
        <div className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Field Reports</div>
      </div>
      <div className="rounded-xl border border-stone-300 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold">Not authorized</h1>
        <p className="mt-2 text-sm text-stone-600">
          This account isn&apos;t on the approved list for Elite Elevator&apos;s field app. If you think that&apos;s a
          mistake, contact Robert.
        </p>
        <button
          onClick={() => signOut({ redirectUrl: "/sign-in" })}
          className="mt-5 w-full rounded-lg bg-[#1F4B45] py-3 text-sm font-bold uppercase tracking-wider text-stone-50"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
