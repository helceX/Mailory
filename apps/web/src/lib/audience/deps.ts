import "server-only";
import { z } from "zod";
import { contactFilterSchema } from "@mailory/validation";
import { getDb } from "../db";

export const audienceDeps = () => ({ db: getDb().db });

/** Query-string → filter + paging. Unknown params are ignored; bad values are rejected, never coerced. */
export const listQuerySchema = contactFilterSchema.extend({
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function queryObject(url: string) {
  return Object.fromEntries(new URL(url).searchParams.entries());
}
