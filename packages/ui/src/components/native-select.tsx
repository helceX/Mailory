import * as React from "react";
import { cn } from "../lib/cn";

/**
 * Styled native <select>: free keyboard, screen-reader and mobile-picker behaviour. Used for dense
 * filter/bulk toolbars where a custom listbox would be slower and less accessible.
 */
export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <select
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      "h-9 rounded border border-border bg-surface px-2 text-sm text-foreground transition-colors duration-150",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
      invalid && "border-danger",
      className,
    )}
    {...props}
  />
));
NativeSelect.displayName = "NativeSelect";
