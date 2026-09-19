import type { SignalData } from "./protocol";

export interface RtcCallOptions {
  iceServers: RTCIceServer[];
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onLocalStream?: (stream: MediaStream) => void;
  onError?: (error: unknown) => void;
}

/**
 * The peer-to-peer media path. Nothing here talks to the signaling server
 * except through `sendSignal`, which the call session wires to the transport.
 */
export class RtcCall {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  /** Candidates can arrive before the remote description; hold them until it lands. */
  private pendingCandidates: RTCIceCandidateInit[] = [];

  sendSignal: (data: SignalData) => void = () => {};

  constructor(private readonly options: RtcCallOptions) {}

  /**
   * Acquire camera and microphone. Called before an offer or answer so the
   * permission prompt is a direct result of clicking Call or Accept.
   */
  async openMedia(): Promise<MediaStream> {
    if (this.localStream) return this.localStream;
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.options.onLocalStream?.(this.localStream);
    return this.localStream;
  }

  private async peer(): Promise<RTCPeerConnection> {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers: this.options.iceServers });
    this.pc = pc;

    const stream = await this.openMedia();
    for (const track of stream.getTracks()) pc.addTrack(track, stream);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({ candidate: event.candidate.toJSON() });
      }
    };
    pc.ontrack = (event) => {
      if (event.streams[0]) this.options.onRemoteStream?.(event.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      this.options.onConnectionState?.(pc.connectionState);
    };
    return pc;
  }

  async createOffer(): Promise<void> {
    const pc = await this.peer();
    await pc.setLocalDescription(await pc.createOffer());
    if (pc.localDescription) {
      this.sendSignal({ sdp: pc.localDescription.toJSON() });
    }
  }

  async acceptOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = await this.peer();
    await pc.setRemoteDescription(sdp);
    await this.flushCandidates();
    await pc.setLocalDescription(await pc.createAnswer());
    if (pc.localDescription) {
      this.sendSignal({ sdp: pc.localDescription.toJSON() });
    }
  }

  async acceptAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(sdp);
    await this.flushCandidates();
  }

  async addCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  private async flushCandidates(): Promise<void> {
    for (const candidate of this.pendingCandidates.splice(0)) {
      try {
        await this.pc?.addIceCandidate(candidate);
      } catch (error) {
        this.options.onError?.(error);
      }
    }
  }

  setMic(enabled: boolean): void {
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = enabled;
  }

  setCam(enabled: boolean): void {
    for (const track of this.localStream?.getVideoTracks() ?? []) track.enabled = enabled;
  }

  close(): void {
    this.pc?.close();
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.pc = null;
    this.localStream = null;
    this.pendingCandidates = [];
  }
}