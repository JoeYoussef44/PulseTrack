import NextAuth from "next-auth";

import { authConfig } from "./auth.config";

/**
 * Edge proxy (formerly `middleware` — renamed in Next.js 16): the cheap first
 * gate. It only inspects the session cookie. The real authorisation happens
 * again in each page via auth() and again in each mutation via
 * requireClinician(), because a misconfigured matcher here would otherwise
 * silently open everything.
 *
 * Uses the edge-safe half of the config only — no Prisma, no bcrypt.
 */
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|csv)$).*)",
  ],
};
