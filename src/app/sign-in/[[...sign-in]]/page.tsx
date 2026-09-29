import { SignIn } from "@clerk/nextjs";

// The sign-in screen. With Google set as the only method in Clerk, this shows
// a single "Continue with Google" button. Clerk's box is matched to the style
// guide (money green, soft corners, glass) through its `appearance` settings.
export default function SignInPage() {
  return (
    <main className="rise mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <div className="text-sm font-semibold text-accent-ink">Elite Elevator Inspections</div>
        <h1 className="title mt-1">Field Reports</h1>
      </div>
      <SignIn
        appearance={{
          // Clerk needs a literal color here — keep it equal to --color-accent in globals.css.
          variables: { colorPrimary: "#16A34A", borderRadius: "1rem", fontFamily: "var(--font-sans)" },
          elements: { cardBox: "glass !shadow-glass", card: "!bg-transparent !shadow-none" },
        }}
      />
    </main>
  );
}
