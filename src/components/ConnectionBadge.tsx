"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

type Status = "connecting" | "connected" | "disconnected";

/** Proves one port serves both Next and Socket.IO. */
export function ConnectionBadge() {
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    const socket: Socket = io();
    socket.on("connect", () => setStatus("connected"));
    socket.on("disconnect", () => setStatus("disconnected"));

    return () => {
      socket.close();
    };
  }, []);

  const label =
    status === "connected"
      ? "Realtime connected"
      : status === "connecting"
        ? "Connecting…"
        : "Realtime disconnected";

  const dot =
    status === "connected"
      ? "bg-accent"
      : status === "connecting"
        ? "bg-warn"
        : "bg-danger";

  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface px-3 py-1.5 text-sm text-muted">
      <span aria-hidden className={`size-2 rounded-full ${dot}`} />
      {label}
    </p>
  );
}
