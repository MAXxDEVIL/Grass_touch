// Session access that a plain Node process can import: no `next/headers`, so
// the Socket.IO layer in server.ts can share exactly this code. `session.ts`
// wraps it for request-scoped use.
import { createHash } from "node:crypto";
import { prisma } from "./db.ts";

export const SESSION_COOKIE = "ih_session";

export interface Viewer {
  id: string;
  username: string;
  createdAt: Date;
}

/** The database stores this, never the token itself. */
export const digestToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function viewerFromToken(token: string): Promise<Viewer | null> {
  const id = digestToken(token);
  const session = await prisma.session.findUnique({
    where: { id },
    select: {
      expiresAt: true,
      user: { select: { id: true, username: true, createdAt: true } },
    },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { id } });
    return null;
  }

  return session.user;
}
