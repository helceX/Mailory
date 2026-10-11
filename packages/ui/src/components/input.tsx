import * as React from "react";
import { cn } from "../lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "flex h-9 w-full rounded border border-border bg-surface px-3 text-sm text-foreground",
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
Input.displayName = "Input";
