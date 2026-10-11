import { type NextRequest } from "next/server";
import { isUniqueViolation, validateCredentials } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { seeOther } from "@/lib/http";
import { hashPassword } from "@/lib/password";
import { startSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  const error = validateCredentials(username, password);
  if (error) return seeOther(request, "/register", { error });

  try {
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword(password) },
    });
    await startSession(user.id);
  } catch (cause) {
    if (isUniqueViolation(cause)) {
      return seeOther(request, "/register", { error: "taken" });
    }
    throw cause;
  }

  return seeOther(request, "/account");
}
