import { PrismaPg } from "@prisma/adapter-pg";
// Relative with an explicit extension: server.ts loads this file through plain
// Node, which does not understand the "@/" alias.
import { PrismaClient } from "../generated/prisma/client.ts";

// The database is a runtime concern, but `next build` — on Vercel and any other
// host — evaluates every route module without the .env secrets present. The
// client is therefore built lazily, on first use: the proxy below keeps every
// importer reading `prisma.user...` exactly as before, while no module import
// touches the database or throws until a request actually needs it.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** The one client for this process, built the first time a query runs. */
function getClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env");
  }
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  // Always on the global, not in a module variable. In dev Next.js reloads
  // modules on every edit; in production it bundles each server entry (route,
  // page) separately, so a module-level client would be one per entry — and so
  // one connection pool each, which exhausts a host database's connection
  // budget. The global is shared by every entry in the process.
  globalForPrisma.prisma = client;
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getClient(), property, receiver);
  },
});