import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { seeOther } from "@/lib/http";
import { DUMMY_HASH, verifyPassword } from "@/lib/password";
import { startSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  const user = username
    ? await prisma.user.findUnique({ where: { username } })
    : null;

  // Always run the hash, even for a username that does not exist, so the reply
  // takes the same time either way and cannot be used to probe for accounts.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !ok) {
    return seeOther(request, "/login", { error: "invalid" });
  }

  await startSession(user.id);
  return seeOther(request, "/account");
}
