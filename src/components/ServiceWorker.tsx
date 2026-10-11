"use client";

// Registers the service worker that makes the game installable and keeps the
// shell standing up offline. Only in production: in dev it would fight the
// hot-reloader over whose copy of an asset is current.
import { useEffect } from "react";

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}