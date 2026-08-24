import { z } from "zod";

/**
 * Credential shape. Deliberately permissive on the password: login must not
 * reveal the password policy, and an existing account with a legacy password
 * still has to be able to sign in.
 */
export const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export type Credentials = z.infer<typeof credentialsSchema>;
