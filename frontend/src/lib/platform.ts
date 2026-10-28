/** Small platform helpers for keyboard-shortcut labels and matching. */

export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(
    // userAgentData is not in every TS lib yet
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent,
  );

/** Label for the primary modifier key: ⌘ on Apple platforms, Ctrl elsewhere. */
export const modKeyLabel = isMac ? "⌘" : "Ctrl";
export const shiftKeyLabel = isMac ? "⇧" : "Shift";

/** True when the platform's primary modifier (⌘ / Ctrl) is held. */
export const hasModKey = (e: KeyboardEvent | React.KeyboardEvent) =>
  isMac ? e.metaKey : e.ctrlKey;

/** True on touch-first, narrow screens where the sidebar is a drawer. */
export const isMobileViewport = () =>
  typeof window !== "undefined" && window.innerWidth < 768;
