import * as React from "react";
import { cn } from "../lib/cn";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-0.5 font-extrabold tracking-tight",
        className,
      )}
    >
      Mailory
      <span className="text-accent" aria-hidden="true">
        .
      </span>
    </span>
  );
}
