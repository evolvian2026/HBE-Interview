import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./auth/staff";

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

/** Wrap a route handler so thrown HttpError / ZodError become JSON error responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: { message: e.message } }, e.status);
      if (e instanceof ZodError) return json({ error: { message: "Invalid input", details: e.issues } }, 400);
      console.error(e);
      return json({ error: { message: "Something went wrong" } }, 500);
    }
  };
}
