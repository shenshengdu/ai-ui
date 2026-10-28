"use client";

import { cn } from "@/lib/utils";
import { ComponentProps, useMemo } from "react";
import { useI18n, type MessageKey } from "@/lib/i18n";

export interface WelcomeProps extends ComponentProps<"div"> {
  isLoading?: boolean;
  isAuthenticated?: boolean;
}

const GREETINGS: MessageKey[] = [
  "welcome.greeting1",
  "welcome.greeting2",
  "welcome.greeting3",
  "welcome.greeting4",
  "welcome.greeting5",
];

/** Empty-chat greeting shown above the centered composer (ChatGPT-style). */
export const Welcome = ({
  className,
  isLoading = false,
  isAuthenticated = true,
  ...props
}: WelcomeProps) => {
  const { t } = useI18n();
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
        {isAuthenticated ? t(greeting) : t("welcome.guestTitle")}
      </h1>
      {!isLoading && !isAuthenticated && (
        <p className="mt-3 max-w-md text-center text-sm text-muted-foreground animate-slide-up">
          {t("welcome.guestBody")}
        </p>
      )}
    </div>
  );
};
