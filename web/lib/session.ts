import type { PublicUser } from "./protocol";

/**
 * Identity lives in sessionStorage so it is scoped to one tab: two tabs in the
 * same browser must be able to hold two different sessions, otherwise nobody
 * can demo a patient and a doctor side by side on their own machine.
 * Browser-level preferences (server URL) stay in localStorage — they belong to
 * the machine, not to a session.
 */
const KEY_TOKEN = "atf.token";
const KEY_USER = "atf.user";
const KEY_SERVER = "atf.server";

export interface StoredSession {
  token: string;
  user: PublicUser;
}

export function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  const token = sessionStorage.getItem(KEY_TOKEN);
  const rawUser = sessionStorage.getItem(KEY_USER);
  if (!token || !rawUser) return null;
  try {
    return { token, user: JSON.parse(rawUser) as PublicUser };
  } catch {
    return null;
  }
}

export function writeSession(session: StoredSession): void {
  sessionStorage.setItem(KEY_TOKEN, session.token);
  sessionStorage.setItem(KEY_USER, JSON.stringify(session.user));
}

export function clearSession(): void {
  sessionStorage.removeItem(KEY_TOKEN);
  sessionStorage.removeItem(KEY_USER);
}

/**
 * Explicit `?server=` override wins, then build config, then a stored override,
 * then same-origin.
 */
export function signalingUrl(): string {
  if (typeof window === "undefined") return "";

  const override = new URLSearchParams(window.location.search).get("server");
  if (override) {
    localStorage.setItem(KEY_SERVER, override);
    return override;
  }

  const configured = process.env.NEXT_PUBLIC_SIGNALING_URL;
  if (configured) return configured;

  const stored = localStorage.getItem(KEY_SERVER);
  if (stored) return stored;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

/** True when no signaling server is configured and the same-origin guess is
 *  almost certainly wrong (i.e. the Next.js dev server or Vercel). */
export function signalingUrlLooksUnconfigured(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_SIGNALING_URL) return false;
  if (new URLSearchParams(window.location.search).get("server")) return false;
  if (localStorage.getItem(KEY_SERVER)) return false;
  return true;
}