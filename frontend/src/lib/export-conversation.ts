import type { FrontendMessage } from "@/lib/api/types";

/** Render the visible branch of a conversation as Markdown. */
export function conversationToMarkdown(
  title: string,
  messages: FrontendMessage[],
): string {
  const lines: string[] = [`# ${title || "Chat"}`, ""];
  for (const m of messages) {
    if (m.error && !m.content) continue;
    const who =
      m.role === "user" ? "You" : `Assistant${m.model ? ` (${m.model})` : ""}`;
    lines.push(`### ${who}`, "");
    const files = m.attachments?.map((a) => a.file?.name).filter(Boolean);
    if (files && files.length > 0) {
      lines.push(`_Attachments: ${files.join(", ")}_`, "");
    }
    lines.push((m.content || "").trim(), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** Trigger a browser download of a text file. */
export function downloadTextFile(filename: string, text: string, type = "text/markdown") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Filesystem-safe filename from a chat title. */
export function safeFilename(title: string, ext = "md") {
  const base =
    (title || "chat")
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "chat";
  return `${base}.${ext}`;
}
