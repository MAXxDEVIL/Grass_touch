import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db.ts";
import {
  digestToken,
  SESSION_COOKIE,
  viewerFromToken,
  type Viewer,
} from "./session-record.ts";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type { Viewer };

export async function startSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: { id: digestToken(token), userId, expiresAt },
  });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);

  if (token) {
    await prisma.session.deleteMany({ where: { id: digestToken(token) } });
  }
}

/** The signed-in user, or null. Expired sessions are cleaned up on read. */
export async function getViewer(): Promise<Viewer | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? viewerFromToken(token) : null;
}
