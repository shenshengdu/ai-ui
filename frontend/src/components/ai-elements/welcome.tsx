"use client";

import { cn } from "@/lib/utils";
import { ComponentProps, useMemo } from "react";

export interface WelcomeProps extends ComponentProps<"div"> {
  isLoading?: boolean;
  isAuthenticated?: boolean;
}

const GREETINGS = [
  "What can I help with?",
  "What's on your mind today?",
  "Where should we begin?",
  "What are you working on?",
  "Ready when you are.",
];

/** Empty-chat greeting shown above the centered composer (ChatGPT-style). */
export const Welcome = ({
  className,
  isLoading = false,
  isAuthenticated = true,
  ...props
}: WelcomeProps) => {
  // Pick once per mount so the heading doesn't flicker on re-render.
  const greeting = useMemo(
    () => GREETINGS[Math.floor(Math.random() * GREETINGS.length)],
    [],
  );

  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center select-none",
        className,
      )}
      {...props}
    >
      <h1
        className={cn(
          "text-center text-[28px] font-normal tracking-tight text-foreground sm:text-[32px] animate-slide-up",
          isLoading && "invisible",
        )}
      >
        {isAuthenticated ? greeting : "Welcome to SSD AI"}
      </h1>
      {!isLoading && !isAuthenticated && (
        <p className="mt-3 max-w-md text-center text-sm text-muted-foreground animate-slide-up">
          Log in to load your conversations and start chatting.
        </p>
      )}
    </div>
  );
};
