import * as React from "react";
import { cn } from "../lib/cn";
import { Label } from "./label";

export interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

/** Accessible label + control + error/hint wiring in one place, so every
 * form field on every screen gets aria-describedby/aria-invalid for free
 * (brief §60 accessibility requirements). */
export function Field({
  id,
  label,
  error,
  hint,
  required,
  children,
  className,
}: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id,
            "aria-describedby": error ? errorId : hint ? hintId : undefined,
            "aria-invalid": Boolean(error) || undefined,
            // aria-invalid alone only tells assistive tech about the
            // error — Input/Textarea/Select's own red-border styling
            // is driven by this separate `invalid` prop, so it must be
            // forwarded too or the visual error state never renders.
            invalid: Boolean(error),
          })
        : children}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
