import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Keyboard key hint, e.g. <Kbd keys={["⌘", "K"]} />. */
export function Kbd({
  keys,
  className,
  ...props
}: ComponentProps<"span"> & { keys: string[] }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 select-none", className)}
      {...props}
    >
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-background px-1 font-sans text-[11px] font-medium text-muted-foreground"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
