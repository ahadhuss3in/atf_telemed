"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Binds a MediaStream to a <video>. Streams are mutable browser objects, so
 * they are attached imperatively here rather than passed through props.
 */
export function VideoStream({
  stream,
  className,
  muted = false,
}: {
  stream: MediaStream | null;
  className: string;
  muted?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

export function TopBar({
  name,
  detail,
  onSignOut,
}: {
  name: string;
  detail: string;
  onSignOut: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        atf <span>telehealth</span>
      </div>
      <div className="spacer" />
      <div className="who">
        <div className="name" data-testid="who-name">
          {name}
        </div>
        <div className="role" data-testid="who-detail">
          {detail}
        </div>
      </div>
      <button className="ghost" onClick={onSignOut} data-testid="sign-out">
        Sign out
      </button>
    </header>
  );
}

/**
 * The most common setup mistake is an unset NEXT_PUBLIC_SIGNALING_URL, which
 * otherwise shows up as a page that silently never connects.
 */
export function ServerBanner({
  unconfigured,
  url,
}: {
  unconfigured: boolean;
  url: string;
}) {
  if (!unconfigured) return null;
  return (
    <div className="notice" data-testid="server-banner">
      <strong>No signaling server configured.</strong> This page is trying{" "}
      <code>{url}</code>. Set <code>NEXT_PUBLIC_SIGNALING_URL</code> in{" "}
      <code>web/.env.local</code> — for local development that is{" "}
      <code>ws://127.0.0.1:8000/ws</code> — then restart <code>npm run dev</code>.
    </div>
  );
}

/** Seconds elapsed since `active` became true, for the in-call timer. */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  return seconds;
}

export function formatDuration(totalSeconds: number): string {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function initials(name: string): string {
  return name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}