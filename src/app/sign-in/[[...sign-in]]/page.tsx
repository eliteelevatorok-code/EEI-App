import { SignIn } from "@clerk/nextjs";

// The sign-in screen. With Google set as the only method in Clerk, this shows
// a single "Continue with Google" button under the "EEI Field Reports" name.
export default function SignInPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <div className="text-xl font-extrabold tracking-wide text-[#1F4B45]">ELITE ELEVATOR</div>
        <div className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
          Field Reports
        </div>
      </div>
      <SignIn />
    </div>
  );
}
