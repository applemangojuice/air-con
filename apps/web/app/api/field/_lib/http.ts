import { z } from "zod";
import { FieldError } from "@/lib/field-server";

/**
 * Shared bits for the field API routes: JSON answers that are never cached,
 * and one place that turns a FieldError (with any gate blockers) into the
 * right status. Each route still runs its own guards first.
 */

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export const notFound = () => json({ error: "Not found" }, 404);

export const projectIdSchema = z.string().uuid();

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

/** Run a field action and answer with its result, or with its error and blockers. */
export async function answer<T>(run: () => Promise<T>): Promise<Response> {
  try {
    return json(await run());
  } catch (err) {
    if (err instanceof FieldError) {
      return json({ error: err.message, ...(err.blockers ? { blockers: err.blockers } : {}) }, err.status);
    }
    console.error("[field api] failed:", err);
    return json({ error: "Something went wrong on our side. Please try again." }, 500);
  }
}
