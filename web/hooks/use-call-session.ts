"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SignalingClient } from "@/lib/bus";
import { CallSession, INITIAL_CALL_STATE, type CallState } from "@/lib/call-session";
import type { Doctor } from "@/lib/protocol";

export interface CallApi {
  call: CallState;
  dial: (doctor: Doctor) => void;
  acceptIncoming: () => void;
  declineIncoming: () => void;
  hangup: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
  clearNotice: () => void;
}

/** Binds the CallSession controller to React state. */
export function useCallSession(
  client: SignalingClient | null,
  iceServers: RTCIceServer[],
): CallApi {
  const iceRef = useRef<RTCIceServer[]>(iceServers);
  useEffect(() => {
    iceRef.current = iceServers;
  }, [iceServers]);

  const [session, setSession] = useState<CallSession | null>(null);

  useEffect(() => {
    if (!client) return;
    // ICE config is read lazily at call time, so a session built before the
    // socket authenticated still uses the servers that arrived on login.
    const created = new CallSession(client, () => iceRef.current);
    setSession(created);
    return () => {
      created.dispose();
      setSession(null);
    };
  }, [client]);

  const subscribe = useCallback(
    (listener: () => void) => session?.subscribe(listener) ?? (() => {}),
    [session],
  );
  const getSnapshot = useCallback(
    () => session?.getSnapshot() ?? INITIAL_CALL_STATE,
    [session],
  );

  const call = useSyncExternalStore(subscribe, getSnapshot, () => INITIAL_CALL_STATE);

  const dial = useCallback((doctor: Doctor) => void session?.dial(doctor), [session]);
  const acceptIncoming = useCallback(() => void session?.acceptIncoming(), [session]);
  const declineIncoming = useCallback(() => session?.declineIncoming(), [session]);
  const hangup = useCallback(() => session?.hangup(), [session]);
  const toggleMic = useCallback(() => session?.toggleMic(), [session]);
  const toggleCam = useCallback(() => session?.toggleCam(), [session]);
  const clearNotice = useCallback(() => session?.clearNotice(), [session]);

  return {
    call,
    dial,
    acceptIncoming,
    declineIncoming,
    hangup,
    toggleMic,
    toggleCam,
    clearNotice,
  };
}