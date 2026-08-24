import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/auth";

export interface ClinicianSession {
  id: string;
  email: string;
  name: string;
}

/**
 * The authorisation check every server action and route handler must call
 * before touching data. Middleware and hidden UI are conveniences; this is the
 * boundary that actually holds when someone posts directly to an endpoint.
 */
export async function requireClinician(): Promise<ClinicianSession> {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
  };
}

/** Same check for API routes, where a redirect would be the wrong response. */
export async function requireClinicianApi(): Promise<ClinicianSession | null> {
  const session = await auth();

  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
  };
}

export async function currentClinician(): Promise<ClinicianSession | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
  };
}
