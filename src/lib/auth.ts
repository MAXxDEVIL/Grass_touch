// Server-side validation and the messages the pages render. No database import
// here, so pages can use it without pulling Prisma into their bundle.

/** Usernames are compared in lower case, so this is the only shape allowed. */
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export const AUTH_ERRORS: Record<string, string> = {
  missing: "Enter a username and a password.",
  username: "Usernames are 3–20 characters: letters, numbers or underscore.",
  password: "Passwords must be 8–128 characters.",
  taken: "That username is already taken.",
  invalid: "Wrong username or password.",
};

/** Returns an AUTH_ERRORS key, or null when the credentials are acceptable. */
export function validateCredentials(
  username: string,
  password: string,
): string | null {
  if (!username || !password) return "missing";
  if (!USERNAME_PATTERN.test(username)) return "username";
  if (password.length < 8 || password.length > 128) return "password";
  return null;
}

/** Prisma's unique-constraint violation, without importing Prisma here. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}
