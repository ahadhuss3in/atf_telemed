/**
 * Wire protocol shared with the FastAPI signaling server (app/signaling.py).
 * Every message is a discriminated union on `t`.
 */

export type Role = "doctor" | "patient";

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  name: string;
  specialty?: string | null;
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  online: boolean;
  busy: boolean;
}

export interface IceConfig {
  iceServers: RTCIceServer[];
}

export interface SignalData {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

/** Server -> client. */
export type ServerMessage =
  | { t: "accounts"; accounts: PublicUser[]; demoPassword: string }
  | { t: "login-ok"; token: string; user: PublicUser; ice: IceConfig }
  | { t: "login-err"; message: string }
  | { t: "hello-ok"; user: PublicUser; ice: IceConfig }
  | { t: "hello-err" }
  | { t: "directory"; doctors: Doctor[] }
  | { t: "call-placed"; callId: string; to: { id: string; name: string } }
  | { t: "incoming"; callId: string; from: { id: string; name: string }; timeout: number }
  | { t: "call-answer"; callId: string; accept: boolean }
  | { t: "signal"; callId: string; data: SignalData }
  | { t: "hangup"; callId: string; reason: HangupReason }
  | { t: "call-error"; code: string; message: string }
  | { t: "error"; message: string };

export type HangupReason =
  | "ended"
  | "declined"
  | "timeout"
  | "peer-gone";

export type ClientMessage =
  | { t: "accounts" }
  | { t: "login"; username: string; password: string }
  | { t: "hello"; token: string }
  | { t: "availability"; online: boolean }
  | { t: "directory" }
  | { t: "call"; to: string }
  | { t: "call-answer"; callId: string; accept: boolean }
  | { t: "signal"; callId: string; data: SignalData }
  | { t: "hangup"; callId: string };

/**
 * Synthetic events the transport emits locally, plus every server message.
 * `__close` is what lets a call screen tear itself down when the socket dies.
 */
export type BusEvent = ServerMessage | { t: "__close" } | { t: "__open" };

export type MessageType = BusEvent["t"];

/**
 * Exhaustive allowlist of inbound message types. Typed as a Record over the
 * union, so adding a message to ServerMessage without listing it here is a
 * compile error rather than a silently dropped message.
 */
const SERVER_MESSAGE_TYPES: Record<ServerMessage["t"], true> = {
  accounts: true,
  "login-ok": true,
  "login-err": true,
  "hello-ok": true,
  "hello-err": true,
  directory: true,
  "call-placed": true,
  incoming: true,
  "call-answer": true,
  signal: true,
  hangup: true,
  "call-error": true,
  error: true,
};

/**
 * Boundary check for JSON off the socket. Validates the discriminant only —
 * enough to route to a typed handler. Field access inside handlers relies on
 * the declared types, which is sound because the server is first-party.
 */
export function isServerMessage(value: unknown): value is ServerMessage {
  if (typeof value !== "object" || value === null || !("t" in value)) return false;
  return typeof value.t === "string" && value.t in SERVER_MESSAGE_TYPES;
}