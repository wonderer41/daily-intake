import { prisma } from "@/lib/db/prisma";
import { safeErrorMessage } from "@/lib/live/redact";

/**
 * True when the database answers a trivial query. A failure is logged server-side only (redacted),
 * tagged with `label` ("health", "page"); callers never pass connection details to the client.
 */
export async function databaseReachable(label: string): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error(`[${label}] database check failed: ${safeErrorMessage(error)}`);
    return false;
  }
}
