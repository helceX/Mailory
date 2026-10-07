"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@mailory/ui";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={compact ? "shrink-0" : "w-full justify-start"}
      aria-label="Çıkış yap"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut aria-hidden="true" /> {compact ? null : "Çıkış yap"}
    </Button>
  );
}
