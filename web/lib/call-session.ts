import { RtcCall } from "./rtc";
import type { SignalingClient } from "./bus";
import type { Doctor, HangupReason, PublicUser, SignalData } from "./protocol";

export type CallPhase = "idle" | "dialing" | "connecting" | "active";

export interface CallPeer {
  id: string;
  name: string;
  detail: string;
}

export interface IncomingCall {
  callId: string;
  from: { id: string; name: string };
  /** Seconds the server will ring before timing the call out. */
  timeout: number;
}

export interface CallState {
  phase: CallPhase;
  peer: CallPeer | null;
  incoming: IncomingCall | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  connection: RTCPeerConnectionState | null;
  /** One-shot message for the UI to surface, cleared with `clearNotice`. */
  notice: string | null;
}

export const INITIAL_CALL_STATE: CallState = {
  phase: "idle",
  peer: null,
  incoming: null,
  localStream: null,
  remoteStream: null,
  micOn: true,
  camOn: true,
  connection: null,
  notice: null,
};

type LocalReason = HangupReason | "media-error" | "signaling-lost";

const NOTICE_BY_REASON: Record<LocalReason, string> = {
  ended: "Call ended.",
  declined: "Call declined.",
  timeout: "No answer — the doctor did not pick up.",
  "peer-gone": "The other side disconnected.",
  "media-error": "Could not access your camera or microphone.",
  "signaling-lost": "Lost the signaling server, so the call was closed.",
};

/**
 * The call state machine: transport + peer connection in, a single immutable
 * snapshot out, which React binds with `useSyncExternalStore`.
 *
 * Kept as a plain class rather than hooks on purpose. This logic is driven by
 * socket events and RTCPeerConnection callbacks, and React 19 runs effects
 * twice in development; expressing it as effects would invite double-dial and
 * double-subscribe bugs for no gain.
 */
export class CallSession {
  private readonly unsubscribes: Array<() => void> = [];
  private readonly listeners = new Set<() => void>();

  private rtc: RtcCall | null = null;
  private callId: string | null = null;
  private peer: CallPeer | null = null;
  private pending: IncomingCall | null = null;
  private phase: CallPhase = "idle";
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private micOn = true;
  private camOn = true;
  private connection: RTCPeerConnectionState | null = null;
  private notice: string | null = null;
  private snapshot: CallState = INITIAL_CALL_STATE;

  constructor(
    private readonly signaling: SignalingClient,
    /** Resolved per call so the ICE config that arrived on login is used even
     *  though this session may have been constructed before it landed. */
    private readonly getIceServers: () => RTCIceServer[],
  ) {
    this.unsubscribes.push(
      signaling.on("call-placed", (m) => {
        if (m.t !== "call-placed") return;
        this.callId = m.callId;
        this.setPhase("dialing");
      }),
      signaling.on("incoming", (m) => {
        if (m.t !== "incoming") return;
        this.pending = { callId: m.callId, from: m.from, timeout: m.timeout };
        this.publish();
      }),
      signaling.on("call-answer", (m) => {
        if (m.t !== "call-answer" || m.callId !== this.callId) return;
        if (!m.accept) {
          this.finish("declined");
          return;
        }
        this.setPhase("connecting");
        void this.rtc?.createOffer().catch(() => this.finish("media-error"));
      }),
      signaling.on("signal", (m) => {
        if (m.t !== "signal" || m.callId !== this.callId || !this.rtc) return;
        void this.applySignal(m.data);
      }),
      signaling.on("hangup", (m) => {
        if (m.t !== "hangup") return;
        // Caller gave up while this portal was still showing the ring prompt.
        if (this.pending?.callId === m.callId) {
          this.pending = null;
          this.publish();
        }
        if (m.callId !== this.callId) return;
        this.finish(m.reason);
      }),
      signaling.on("call-error", (m) => {
        if (m.t !== "call-error") return;
        if (this.phase !== "dialing" && this.phase !== "connecting") return;
        this.finish(null, m.message);
      }),
      // The server ends any call owned by a disconnected socket, so a dropped
      // signaling connection must tear the call down here too — otherwise the
      // peer silently stays in a call that no longer exists.
      signaling.on("__close", () => {
        if (this.phase === "idle" && !this.pending) return;
        this.pending = null;
        this.finish("signaling-lost");
      }),
    );
  }

  // ------------------------------------------------------------ react binding

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CallState => this.snapshot;

  clearNotice = (): void => {
    if (this.notice === null) return;
    this.notice = null;
    this.publish();
  };

  // ------------------------------------------------------------------ actions

  /** Patient side: place a call to a doctor from the directory. */
  async dial(doctor: Doctor): Promise<void> {
    this.peer = { id: doctor.id, name: doctor.name, detail: doctor.specialty };
    this.setPhase("dialing");
    this.rtc = this.createRtc();
    try {
      await this.rtc.openMedia();
    } catch {
      this.finish("media-error");
      return;
    }
    this.signaling.send({ t: "call", to: doctor.id });
  }

  async acceptIncoming(): Promise<void> {
    const incoming = this.pending;
    if (!incoming) return;
    this.pending = null;
    this.callId = incoming.callId;
    this.peer = {
      id: incoming.from.id,
      name: incoming.from.name,
      detail: "Video consultation",
    };
    this.setPhase("connecting");
    this.rtc = this.createRtc();
    try {
      await this.rtc.openMedia();
    } catch {
      this.signaling.send({ t: "call-answer", callId: incoming.callId, accept: false });
      this.finish("media-error");
      return;
    }
    this.signaling.send({ t: "call-answer", callId: incoming.callId, accept: true });
  }

  declineIncoming(): void {
    const incoming = this.pending;
    if (!incoming) return;
    this.pending = null;
    this.publish();
    this.signaling.send({ t: "call-answer", callId: incoming.callId, accept: false });
  }

  hangup(): void {
    if (this.callId) this.signaling.send({ t: "hangup", callId: this.callId });
    this.finish("ended");
  }

  toggleMic(): void {
    this.micOn = !this.micOn;
    this.rtc?.setMic(this.micOn);
    this.publish();
  }

  toggleCam(): void {
    this.camOn = !this.camOn;
    this.rtc?.setCam(this.camOn);
    this.publish();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.rtc?.close();
    this.rtc = null;
    this.listeners.clear();
  }

  // ---------------------------------------------------------------- internals

  private async applySignal(data: SignalData): Promise<void> {
    try {
      if (data.sdp) {
        if (data.sdp.type === "offer") await this.rtc?.acceptOffer(data.sdp);
        else if (data.sdp.type === "answer") await this.rtc?.acceptAnswer(data.sdp);
      } else if (data.candidate) {
        await this.rtc?.addCandidate(data.candidate);
      }
    } catch {
      this.finish("media-error");
    }
  }

  private createRtc(): RtcCall {
    const rtc = new RtcCall({
      iceServers: this.getIceServers(),
      onConnectionState: (connection) => {
        this.connection = connection;
        if (connection === "connected") this.phase = "active";
        this.publish();
      },
      onLocalStream: (stream) => {
        this.localStream = stream;
        this.publish();
      },
      onRemoteStream: (stream) => {
        this.remoteStream = stream;
        this.publish();
      },
      onError: (error) => console.warn("rtc", error),
    });

    // Read the call id at send time: the peer connection is built before the
    // server has issued one, so capturing it here would drop the offer and
    // every ICE candidate.
    rtc.sendSignal = (data) => {
      if (!this.callId) return;
      this.signaling.send({ t: "signal", callId: this.callId, data });
    };
    return rtc;
  }

  private setPhase(phase: CallPhase): void {
    this.phase = phase;
    this.publish();
  }

  private finish(reason: LocalReason | null, notice?: string): void {
    if (this.phase === "idle") return; // a stray message for a call we already left

    this.rtc?.close();
    this.rtc = null;
    this.callId = null;
    this.peer = null;
    this.pending = null;
    this.localStream = null;
    this.remoteStream = null;
    this.connection = null;
    this.micOn = true;
    this.camOn = true;
    this.phase = "idle";
    this.notice = notice ?? (reason ? NOTICE_BY_REASON[reason] : "Call ended.");
    this.publish();
  }

  private publish(): void {
    this.snapshot = {
      phase: this.phase,
      peer: this.peer,
      incoming: this.pending,
      localStream: this.localStream,
      remoteStream: this.remoteStream,
      micOn: this.micOn,
      camOn: this.camOn,
      connection: this.connection,
      notice: this.notice,
    };
    for (const listener of this.listeners) listener();
  }
}

/** Display name for a signed-in user, used by both portals. */
export function describeUser(user: PublicUser): string {
  return user.specialty ? `${user.role} · ${user.specialty}` : user.role;
}