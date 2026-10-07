"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FormError, Notice } from "./auth-card";

/** Verification is a POST (never a GET side-effect), so mail scanners that prefetch links can't burn the token. */
export function VerifyEmailClient({ token }: { token: string }) {
  const [state, setState] = useState<"pending" | "ok" | "error">("pending");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((response) => setState(response.ok ? "ok" : "error"))
      .catch(() => setState("error"));
  }, [token]);

  if (state === "pending")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Doğrulanıyor…
      </p>
    );
  if (state === "error")
    return (
      <FormError message="Bağlantı geçersiz veya süresi dolmuş. Giriş yapmayı deneyin; gerekirse yeniden kayıt olun." />
    );
  return (
    <div className="flex flex-col gap-4">
      <Notice>E-posta adresiniz doğrulandı.</Notice>
      <Link href="/login" className="text-center text-sm text-primary hover:underline">
        Giriş yap
      </Link>
    </div>
  );
}
