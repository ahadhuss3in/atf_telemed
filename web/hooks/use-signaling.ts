"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SignalingClient, type ConnectionStatus } from "@/lib/bus";
import type { PublicUser } from "@/lib/protocol";
import {
  clearSession,
  readSession,
  signalingUrl,
  signalingUrlLooksUnconfigured,
  writeSession,
} from "@/lib/session";

export interface SignalingApi {
  client: SignalingClient | null;
  status: ConnectionStatus;
  url: string;
  /** Null until the stored session is read, or the socket authenticates. */
  user: PublicUser | null;
  /** True only while the current socket has authenticated. Reset on disconnect
   *  so that per-connection state (a doctor's availability) is re-asserted. */
  authenticated: boolean;
  iceServers: RTCIceServer[];
  accounts: PublicUser[];
  demoPassword: string;
  authError: string | null;
  /** True once the client exists and the stored-session read has happened. */
  ready: boolean;
  unconfiguredServer: boolean;
  login: (username: string, password: string) => void;
  logout: () => void;
}

/**
 * Owns the signaling socket: one connection per mounted page, torn down on
 * unmount, with the stored session re-authenticated on every (re)open.
 */
export function useSignaling(): SignalingApi {
  const [client, setClient] = useState<SignalingClient | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);
  const [accounts, setAccounts] = useState<PublicUser[]>([]);
  const [demoPassword, setDemoPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [unconfiguredServer, setUnconfiguredServer] = useState(false);

  // One client for the lifetime of the page. Created in an effect so no socket
  // is opened during server rendering.
  useEffect(() => {
    const created = new SignalingClient(signalingUrl());
    setUnconfiguredServer(signalingUrlLooksUnconfigured());
    setClient(created);
    return () => {
      created.dispose();
      setClient(null);
    };
  }, []);

  const status = useSyncExternalStore(
    useCallback((listener: () => void) => client?.subscribe(listener) ?? (() => {}), [client]),
    useCallback(() => client?.getSnapshot().status ?? ("idle" as ConnectionStatus), [client]),
    () => "idle" as ConnectionStatus,
  );

  // Read the stored session once mounted (sessionStorage is client-only).
  useEffect(() => {
    const stored = readSession();
    if (stored) setUser(stored.user);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!client) return;

    const unsubscribes = [
      client.on("__open", () => {
        const stored = readSession();
        if (stored) client.send({ t: "hello", token: stored.token });
      }),
      client.on("__close", () => setAuthenticated(false)),
      client.on("login-ok", (m) => {
        if (m.t !== "login-ok") return;
        writeSession({ token: m.token, user: m.user });
        setUser(m.user);
        setIceServers(m.ice.iceServers);
        setAuthError(null);
        setAuthenticated(true);
      }),
      client.on("login-err", (m) => {
        if (m.t !== "login-err") return;
        setAuthError(m.message);
        setAuthenticated(false);
      }),
      client.on("hello-ok", (m) => {
        if (m.t !== "hello-ok") return;
        const stored = readSession();
        if (stored) writeSession({ token: stored.token, user: m.user });
        setUser(m.user);
        setIceServers(m.ice.iceServers);
        setAuthenticated(true);
      }),
      client.on("hello-err", () => {
        clearSession();
        setUser(null);
        setAuthenticated(false);
      }),
    ];

    client.connect();
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [client]);

  const login = useCallback(
    (username: string, password: string) => {
      setAuthError(null);
      client?.send({ t: "login", username, password });
    },
    [client],
  );

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  // The login screen needs the demo account list; ask for it once connected.
  const askedForAccounts = useRef(false);
  useEffect(() => {
    if (!client || status !== "open" || askedForAccounts.current) return;
    askedForAccounts.current = true;
    const unsubscribe = client.on("accounts", (m) => {
      if (m.t !== "accounts") return;
      setAccounts(m.accounts);
      setDemoPassword(m.demoPassword);
    });
    client.send({ t: "accounts" });
    return unsubscribe;
  }, [client, status]);

  return {
    client,
    status,
    url: client?.url ?? "",
    user,
    authenticated,
    iceServers,
    accounts,
    demoPassword,
    authError,
    ready,
    unconfiguredServer,
    login,
    logout,
  };
}