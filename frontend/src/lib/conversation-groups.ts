import type { ClientConversation } from "@/lib/clientConversationManager";

/** Last-activity timestamp (ms) of a conversation, 0 when unknown. */
export const conversationUpdatedAt = (c: ClientConversation): number => {
  const raw =
    c.backendConversation?.updatedAt || c.backendConversation?.createdAt;
  if (!raw) return Date.now(); // brand-new local conversation → treat as now
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
};

/**
 * ChatGPT-style history bucket: Today / Yesterday / Previous 7 Days /
 * Previous 30 Days / "Month" (this year) / "Month Year" (older).
 */
export const conversationGroupLabel = (
  updatedAt: number,
  now: Date = new Date(),
): string => {
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const DAY = 86_400_000;

  if (updatedAt >= startOfToday) return "Today";
  if (updatedAt >= startOfToday - DAY) return "Yesterday";
  if (updatedAt >= startOfToday - 7 * DAY) return "Previous 7 Days";
  if (updatedAt >= startOfToday - 30 * DAY) return "Previous 30 Days";

  const d = new Date(updatedAt);
  return d.getFullYear() === now.getFullYear()
    ? d.toLocaleString("en-US", { month: "long" })
    : d.toLocaleString("en-US", { month: "long", year: "numeric" });
};

/** Group conversations (already sorted newest-first) preserving order. */
export function groupConversations<T extends ClientConversation>(
  conversations: T[],
): { label: string; items: T[] }[] {
  const now = new Date();
  const groups: { label: string; items: T[] }[] = [];
  const index = new Map<string, number>();
  for (const c of conversations) {
    const label = conversationGroupLabel(conversationUpdatedAt(c), now);
    let i = index.get(label);
    if (i === undefined) {
      i = groups.length;
      index.set(label, i);
      groups.push({ label, items: [] });
    }
    groups[i].items.push(c);
  }
  return groups;
}
