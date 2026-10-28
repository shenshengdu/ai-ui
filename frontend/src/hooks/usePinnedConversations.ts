import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ai-ui-pinned-conversations";
const EVENT = "ai-ui-pinned-change";

function readPinned(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function writePinned(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable — pinning silently becomes session-only */
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Pinned conversations, kept per browser in localStorage (the backend has no
 * pin field). Most recently pinned first, like ChatGPT.
 */
export function usePinnedConversations() {
  const [pinned, setPinned] = useState<string[]>(readPinned);

  useEffect(() => {
    const sync = () => setPinned(readPinned());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const togglePin = useCallback((id: string) => {
    const current = readPinned();
    const next = current.includes(id)
      ? current.filter((p) => p !== id)
      : [id, ...current];
    writePinned(next);
    setPinned(next);
  }, []);

  const unpin = useCallback((id: string) => {
    const current = readPinned();
    if (!current.includes(id)) return;
    const next = current.filter((p) => p !== id);
    writePinned(next);
    setPinned(next);
  }, []);

  return { pinned, togglePin, unpin };
}
