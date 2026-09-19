"use client";

import { useEffect, useState } from "react";
import type { IncomingCall } from "@/lib/call-session";

/** Ring prompt. The server owns the timeout; this only counts it down. */
export function IncomingCallModal({
  incoming,
  onAccept,
  onDecline,
}: {
  incoming: IncomingCall;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [remaining, setRemaining] = useState(Math.ceil(incoming.timeout));

  useEffect(() => {
    setRemaining(Math.ceil(incoming.timeout));
    const timer = setInterval(() => setRemaining((value) => Math.max(value - 1, 0)), 1000);
    return () => clearInterval(timer);
  }, [incoming.timeout, incoming.callId]);

  return (
    <div className="modal" data-testid="incoming">
      <div className="modal-card">
        <div className="spinner" />
        <h3 data-testid="incoming-name">{incoming.from.name}</h3>
        <p>
          Incoming video consultation ·{" "}
          <span data-testid="incoming-count">{remaining}</span>s
        </p>
        <div className="modal-actions">
          <button className="danger" onClick={onDecline} data-testid="decline">
            Decline
          </button>
          <button className="primary" onClick={onAccept} data-testid="accept">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}