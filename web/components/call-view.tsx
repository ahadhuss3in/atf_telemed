"use client";

import { formatDuration, useElapsedSeconds, VideoStream } from "./primitives";
import type { CallState } from "@/lib/call-session";

const TURN_HINT = "Connection failed — a TURN server may be required on this network";

function badgeFor(call: CallState, elapsed: number): { text: string; tone: string } {
  if (call.connection === "connected") {
    return { text: `Live · ${formatDuration(elapsed)}`, tone: "badge live" };
  }
  if (call.connection === "failed") return { text: TURN_HINT, tone: "badge warn" };
  if (call.connection === "disconnected") return { text: "Reconnecting…", tone: "badge warn" };
  return { text: statusLine(call), tone: "badge" };
}

function statusLine(call: CallState): string {
  if (call.phase === "dialing") return `Calling ${call.peer?.name ?? "…"}…`;
  if (call.localStream && !call.remoteStream) {
    return "Your camera is on — waiting for the other side.";
  }
  return "Connecting…";
}

export function CallView({
  call,
  onHangup,
  onToggleMic,
  onToggleCam,
}: {
  call: CallState;
  onHangup: () => void;
  onToggleMic: () => void;
  onToggleCam: () => void;
}) {
  const elapsed = useElapsedSeconds(call.connection === "connected");
  const badge = badgeFor(call, elapsed);

  return (
    <>
      <div className="stage">
        <VideoStream stream={call.remoteStream} className="remote" />
        {!call.remoteStream && (
          <div className="placeholder">
            {call.connection !== "failed" && <div className="spinner" />}
            <div className="big">Waiting for video…</div>
            <div className="sub" data-testid="placeholder-sub">
              {statusLine(call)}
            </div>
          </div>
        )}
        <VideoStream stream={call.localStream} className="local" muted />
        <div className={badge.tone} data-testid="badge">
          {badge.text}
        </div>
      </div>

      <div className="callbar">
        <div className="peer">
          <div className="name">{call.peer?.name}</div>
          <div className="detail">{call.peer?.detail}</div>
        </div>
        <button
          className={call.micOn ? undefined : "off"}
          onClick={onToggleMic}
          data-testid="mic"
        >
          {call.micOn ? "Mute" : "Unmute"}
        </button>
        <button
          className={call.camOn ? undefined : "off"}
          onClick={onToggleCam}
          data-testid="cam"
        >
          {call.camOn ? "Camera off" : "Camera on"}
        </button>
        <button className="danger" onClick={onHangup} data-testid="end">
          End call
        </button>
      </div>
    </>
  );
}