import * as React from "react";
import { cn } from "../lib/cn";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "flex min-h-16 w-full rounded border border-border bg-surface px-3 py-2 text-sm text-foreground",
        "placeholder:text-muted-foreground transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid && "border-danger focus-visible:ring-danger",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
