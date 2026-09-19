"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CallView } from "@/components/call-view";
import { DoctorDirectory } from "@/components/doctor-directory";
import { ServerBanner, TopBar } from "@/components/primitives";
import { Toast, useToast } from "@/components/toast";
import { useCallSession } from "@/hooks/use-call-session";
import { useSignaling } from "@/hooks/use-signaling";
import type { Doctor } from "@/lib/protocol";

export default function PatientPage() {
  const router = useRouter();
  const signaling = useSignaling();
  const { call, dial, hangup, toggleMic, toggleCam, clearNotice } = useCallSession(
    signaling.client,
    signaling.iceServers,
  );
  const { toast, show } = useToast();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [query, setQuery] = useState("");

  const { client, authenticated, ready, user, status, unconfiguredServer, url, logout } = signaling;

  // Only patients belong here.
  useEffect(() => {
    if (!ready || user?.role === "patient") return;
    router.replace(user ? "/doctor" : "/");
  }, [ready, user, router]);

  // Directory updates. Re-requested whenever the socket re-authenticates, since
  // the server only pushes to patients it currently knows about.
  useEffect(() => {
    if (!client || !authenticated) return;
    const unsubscribe = client.on("directory", (message) => {
      if (message.t === "directory") setDoctors(message.doctors);
    });
    client.send({ t: "directory" });
    return unsubscribe;
  }, [client, authenticated]);

  useEffect(() => {
    if (!call.notice) return;
    show(call.notice);
    clearNotice();
  }, [call.notice, show, clearNotice]);

  useEffect(() => {
    if (status !== "closed") return;
    show("Lost the signaling server — reconnecting…", { error: true });
  }, [status, show]);

  if (!ready || !user) return <div className="center-note">Connecting…</div>;

  return (
    <>
      <TopBar
        name={user.name}
        detail="Patient"
        onSignOut={() => {
          logout();
          router.replace("/");
        }}
      />

      <main>
        <ServerBanner unconfigured={unconfiguredServer} url={url} />

        {call.phase === "idle" ? (
          <DoctorDirectory
            doctors={doctors}
            query={query}
            onQueryChange={setQuery}
            onCall={dial}
            callInProgress={false}
          />
        ) : (
          <CallView
            call={call}
            onHangup={hangup}
            onToggleMic={toggleMic}
            onToggleCam={toggleCam}
          />
        )}
      </main>

      <Toast toast={toast} />
    </>
  );
}