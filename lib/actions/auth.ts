"use server";

import { AuthError } from "next-auth";

import { signIn, signOut } from "@/auth";
import { credentialsSchema } from "@/lib/validation/auth";

export interface LoginState {
  error?: string;
}

/**
 * Sign-in server action.
 *
 * The error message is identical for an unknown email and a wrong password.
 * Combined with the dummy-hash comparison in auth.ts, that means login reveals
 * nothing about which addresses have accounts.
 */
export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Enter your email address and password." };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    // A successful sign-in is signalled by throwing a redirect, which is not
    // an AuthError — so rethrowing anything that is not an AuthError lets the
    // redirect through without depending on Next.js internals.
    if (error instanceof AuthError) {
      return { error: "Invalid email or password." };
    }

    throw error;
  }

  return {};
}

export async function logout(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
