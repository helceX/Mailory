import * as React from "react";
import { cn } from "../lib/cn";

/** Horizontally scrollable on narrow screens instead of shrinking the columns (see DESIGN notes in docs). */
export function TableContainer({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("overflow-x-auto rounded-lg border bg-surface", className)}
      {...props}
    />
  );
}
export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full text-sm", className)} {...props} />;
}
export function THead({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "border-b bg-surface-muted text-left text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function TBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y", className)} {...props} />;
}
export function TH({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn("whitespace-nowrap px-4 py-2 font-medium", className)}
      {...props}
    />
  );
}
export function TD({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}
