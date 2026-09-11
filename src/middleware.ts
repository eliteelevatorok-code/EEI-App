import { clerkClient, clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isAllowed } from "@/lib/allowlist";

// Public routes that never require sign-in. The PO submission page/API and the
// push-run endpoint are public on purpose (a random token / secret authorizes
// them), never signed in.
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/not-authorized",
  "/po(.*)",
  "/api/po(.*)",
  "/pay(.*)",
  "/api/pay(.*)",
  "/api/push/run(.*)",
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
