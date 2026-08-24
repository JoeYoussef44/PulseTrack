import type { DefaultSession } from "next-auth";

/**
 * The Credentials provider returns a clinician, so the session carries the
 * clinician id. Declaring it here means every requireClinician() caller gets
 * a typed id rather than a cast.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    clinicianId?: string;
  }
}
