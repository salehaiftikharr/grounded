import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

/**
 * A lightweight anonymous session so an uploaded corpus stays tied to the
 * visitor who uploaded it, without any login. The id lives in an httpOnly
 * cookie and namespaces rows in the uploaded_chunks table.
 */
export const SESSION_COOKIE = "gsid";
const MAX_AGE_SECONDS = 24 * 60 * 60; // matches the DB TTL

// A well-formed UUID. We only trust cookie values we could have issued, so a
// client cannot inject an arbitrary corpus namespace or fixate a session onto a
// value it controls.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read the session id from the request cookie, or null if none or malformed. */
export function readSessionId(req: NextRequest): string | null {
  const value = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  return value && UUID_RE.test(value) ? value : null;
}

/** A fresh session id. */
export function newSessionId(): string {
  return randomUUID();
}

/** The Set-Cookie header value that persists a session id. */
export function sessionCookie(id: string): string {
  return [
    `${SESSION_COOKIE}=${id}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ].join("; ");
}
