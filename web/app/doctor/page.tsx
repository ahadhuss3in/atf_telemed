"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CallView } from "@/components/call-view";
import { IncomingCallModal } from "@/components/incoming-call-modal";
import { ServerBanner, TopBar } from "@/components/primitives";
import { Toast, useToast } from "@/components/toast";
import { useCallSession } from "@/hooks/use-call-session";
import { useSignaling } from "@/hooks/use-signaling";

const KEY_AVAILABLE = "atf.available";

export default function DoctorPage() {
  const router = useRouter();
  const signaling = useSignaling();
  const { call, acceptIncoming, declineIncoming, hangup, toggleMic, toggleCam, clearNotice } =
    useCallSession(signaling.client, signaling.iceServers);
  const { toast, show } = useToast();
  const [available, setAvailable] = useState(false);

  const { client, authenticated, ready, user, status, unconfiguredServer, url, logout } = signaling;
  const role = user?.role;
  const incoming = call.incoming;

  // Only doctors belong here.
  useEffect(() => {
    if (!ready || role === "doctor") return;
    router.replace(user ? "/patient" : "/");
  }, [ready, role, user, router]);

  // Restore the previous choice; it is a machine preference, not a session one.
  useEffect(() => {
    setAvailable(localStorage.getItem(KEY_AVAILABLE) === "1");
  }, []);

  // Availability is per-connection: the server starts every new socket as
  // unavailable, so it is re-asserted after each re-authentication.
  useEffect(() => {
    if (!client || !authenticated || role !== "doctor") return;
    client.send({ t: "availability", online: available });
  }, [client, authenticated, role, available]);

  useEffect(() => {
    if (!call.notice) return;
    show(call.notice);
    clearNotice();
  }, [call.notice, show, clearNotice]);

  useEffect(() => {
    if (status !== "closed") return;
    show("Lost the signaling server — reconnecting…", { error: true });
  }, [status, show]);

  const toggleAvailability = useCallback(() => {
    setAvailable((current) => {
      localStorage.setItem(KEY_AVAILABLE, current ? "0" : "1");
      return !current;
    });
  }, []);

  if (!ready || !user) return <div className="center-note">Connecting…</div>;

  return (
    <>
      <TopBar
        name={user.name}
        detail={user.specialty ?? "Doctor"}
        onSignOut={() => {
          logout();
          router.replace("/");
        }}
      />

      <main>
        <ServerBanner unconfigured={unconfiguredServer} url={url} />

        {call.phase === "idle" ? (
          <>
            <h2 className="section">Your availability</h2>
            <p className="section-sub">
              Only doctors who are available appear in the patient directory as callable.
            </p>
            <div className="available-row">
              <div className="body">
                <div className="title" data-testid="avail-title">
                  {available ? "Available for calls" : "Offline"}
                </div>
                <div className="detail" data-testid="avail-detail">
                  {available
                    ? "You appear in the patient directory and can receive calls."
                    : "You are hidden from patients. Calls cannot reach you."}
                </div>
              </div>
              <button
                className={available ? undefined : "primary"}
                onClick={toggleAvailability}
                data-testid="toggle"
              >
                {available ? "Go offline" : "Go available"}
              </button>
            </div>
          </>
        ) : (
          <CallView
            call={call}
            onHangup={hangup}
            onToggleMic={toggleMic}
            onToggleCam={toggleCam}
          />
        )}
      </main>

      {incoming && (
        <IncomingCallModal
          key={incoming.callId}
          incoming={incoming}
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}

      <Toast toast={toast} />
    </>
  );
}