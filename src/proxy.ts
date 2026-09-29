import { clerkClient, clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isAllowed } from "@/lib/allowlist";

// Login wall for the whole app (Next 16 calls this file proxy.ts; it used to be
// middleware.ts). Public routes never require sign-in: the customer/maintenance
// pages (PO, maint, pay, report) are opened from emails and authorized by the
// random link token in the address; the scheduler endpoints (push/run,
// push/problem, invoice/run, switches/master) are authorized by the secret in
// schedulerKey.ts.
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/not-authorized",
  "/po(.*)",
  "/api/po(.*)",
  "/maint(.*)",
  "/api/maint(.*)",
  "/api/report(.*)",
  "/pay(.*)",
  "/api/pay(.*)",
  "/api/push/run(.*)",
  "/api/push/problem(.*)",
  "/api/invoice/run(.*)",
  "/api/switches/master(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return;
  const { userId, sessionClaims } = await auth.protect();

  // Enforce the four-email allowlist. Read the email from the session token
  // first (fast); if it isn't there, fetch it from Clerk. Fail CLOSED — if we
  // can't confirm an approved email, turn the person away.
  let email = (sessionClaims as { email?: string } | null)?.email;
  if (!email && userId) {
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
    } catch {
      email = undefined;
    }
  }
  if (!isAllowed(email)) {
    return NextResponse.redirect(new URL("/not-authorized", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
