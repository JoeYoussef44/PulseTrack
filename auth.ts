import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { authConfig } from "./auth.config";
import { prisma } from "@/lib/db";
import { credentialsSchema } from "@/lib/validation/auth";

/**
 * Node-runtime auth. This half touches the database and bcrypt, so it must
 * never be imported from middleware — see auth.config.ts.
 *
 * Clinicians are the only account holders in the system. No patient can
 * authenticate, by design; they reach the questionnaire through a tokenized
 * link instead.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);

        // Returning null produces the same generic error the UI shows for a
        // wrong password, so a malformed payload leaks nothing either.
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const clinician = await prisma.clinician.findUnique({
          where: { email },
          select: { id: true, email: true, name: true, passwordHash: true },
        });

        // Hash a dummy value when the account does not exist, so that an
        // unknown email costs the same time as a wrong password and cannot be
        // distinguished by timing.
        const hash = clinician?.passwordHash ?? DUMMY_HASH;
        const passwordMatches = await bcrypt.compare(password, hash);

        if (!clinician || !passwordMatches) return null;

        return {
          id: clinician.id,
          email: clinician.email,
          name: clinician.name,
        };
      },
    }),
  ],
});

/**
 * A real bcrypt hash of a value nobody can supply. Used only to equalise the
 * cost of the unknown-email path; it can never match a submitted password.
 */
const DUMMY_HASH =
  "$2b$12$C6UzMDM.H6dfI/f/IKcEe.9Nn7VJ0mQnQnDQwbXqXZ7ZqQK1cJqYy";
