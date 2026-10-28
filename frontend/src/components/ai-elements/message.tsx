import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "system" | "user" | "assistant" | string;
  status?: "completed" | "pending";
  error?: string;
};

export const Message = ({
  className,
  from,
  status,
  error,
  ...props
}: MessageProps) => (
  <div
    className={cn(
      "group flex w-full items-start gap-2 py-2 animate-fade-in",
      from === "user" ? "is-user justify-end" : "is-assistant justify-start",
      from === "user"
        ? "[&>div]:max-w-[85%] sm:[&>div]:max-w-[75%] md:[&>div]:max-w-[70%]"
        : "[&>div]:max-w-full",
      error && "is-error",
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement> & {
  content?: string;
};

export const MessageContent = ({
  children,
  className,
  content: _content,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex flex-col gap-2 text-base text-foreground overflow-hidden max-w-full",
      "[line-height:1.75rem]",
      "group-[.is-user]:bg-bubble group-[.is-user]:text-foreground group-[.is-user]:rounded-[22px] group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:w-fit group-[.is-user]:min-w-0",
      "group-[.is-assistant]:bg-transparent group-[.is-assistant]:text-foreground group-[.is-assistant]:px-0 group-[.is-assistant]:py-0 group-[.is-assistant]:w-full group-[.is-assistant]:min-w-0",
      "group-[.is-error.is-user]:bg-transparent group-[.is-error.is-user]:p-0",
      className,
    )}
    {...props}
  >
    <div className="space-y-2 overflow-hidden break-words w-full">
      {children}
    </div>
  </div>
);
