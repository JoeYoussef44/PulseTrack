import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the auth configuration.
 *
 * Middleware runs on the edge runtime, where neither Prisma nor bcrypt can
 * load. Splitting the config in two lets middleware do the cheap check — is
 * there a valid session cookie — while the expensive credential verification
 * stays in the Node runtime (see auth.ts).
 *
 * This file must not import anything that touches the database.
 */

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PREFIXES = [
  "/login",
  /**
   * The patient questionnaire. Patients have no account by design, so this
   * route authorises on the token in the URL rather than on a session.
   */
  "/assessment",
  "/api/auth",
  "/templates",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export const authConfig = {
  /**
   * Auth.js derives callback URLs from the Host header and refuses hosts it
   * cannot verify. It auto-trusts on Vercel, but not behind `next start`
   * locally, so this must be explicit.
   *
   * Safe here because the app is only ever served from hosts we control —
   * localhost in development and the Vercel deployment in production, where
   * the platform sets the Host header itself. It would not be safe behind an
   * arbitrary reverse proxy that forwards attacker-supplied Host values.
   */
  trustHost: true,

  pages: {
    signIn: "/login",
  },

  session: {
    // A database session strategy is not compatible with the Credentials
    // provider, so sessions are stateless JWTs signed with AUTH_SECRET.
    strategy: "jwt",
    maxAge: 60 * 60 * 8, // one clinical shift
  },

  callbacks: {
    /**
     * Gatekeeper for middleware. Returning false sends the visitor to the
     * sign-in page. This is the first of three layers — pages re-check with
     * auth(), and every mutation re-checks with requireClinician().
     */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;

      if (isPublicPath(pathname)) return true;

      /**
       * API routes answer for themselves.
       *
       * A `fetch()` that meets an edge redirect follows it and receives the
       * login page's HTML with a 200. The caller then tries to parse that as
       * JSON, so an expired session surfaces as an unexplained blank result
       * rather than "you have been signed out". A route handler returning a
       * real 401 is the only response shape a fetch caller can act on.
       *
       * This exempts them from the *redirect*, not from authorisation. Every
       * route handler must call `requireClinicianApi()` itself — that is the
       * layer which actually holds, here as everywhere else.
       */
      if (pathname.startsWith("/api/")) return true;

      return Boolean(auth?.user);
    },

    jwt({ token, user }) {
      if (user) {
        token.clinicianId = user.id;
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },

    session({ session, token }) {
      if (token.clinicianId && session.user) {
        session.user.id = token.clinicianId as string;
      }
      return session;
    },
  },

  // Providers are added in auth.ts, which is Node-only.
  providers: [],
} satisfies NextAuthConfig;
