"use client";

import { useEffect, useState } from "react";

/**
 * The browser's idea of whether there's signal (navigator.onLine), kept up
 * to date. True on the server and on first render, so hydration matches.
 * It can say "online" on a dead connection, never the other way round:
 * "offline" is always worth acting on.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const set = () => setOnline(navigator.onLine !== false);
    set();
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
    };
  }, []);
  return online;
}
