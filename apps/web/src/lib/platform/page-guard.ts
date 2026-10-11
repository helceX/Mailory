import "server-only";
import { notFound } from "next/navigation";
import { getOrgContext } from "../org/context";
import type { PlatformActor } from "./service";

/** Pages under /platform: anyone who is not a platform admin gets a plain 404. */
export async function requirePlatformAdmin(): Promise<PlatformActor> {
  const context = await getOrgContext();
  if (!context?.user.isPlatformAdmin) notFound();
  return { userId: context.user.id, isPlatformAdmin: true };
}
