import type { ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "@mailory/ui";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8 text-2xl" aria-label="Mailory">
        <Wordmark />
      </Link>
      <div className="w-full max-w-sm rounded-lg border bg-surface p-6 shadow-sm">
        <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
        <div className="mt-6">{children}</div>
      </div>
      {footer ? <p className="mt-6 text-sm text-muted-foreground">{footer}</p> : null}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      {message}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="rounded border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
    >
      {children}
    </p>
  );
}
