"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OrgSwitcher({
  organizations,
  activeId,
}: {
  organizations: { id: string; name: string }[];
  activeId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const active = organizations.find((o) => o.id === activeId);

  if (organizations.length < 2) {
    return (
      <p className="truncate px-3 text-sm font-semibold" title={active?.name}>
        {active?.name}
      </p>
    );
  }
  return (
    <div className="px-3">
      <label htmlFor="org-switcher" className="sr-only">
        Organizasyon değiştir
      </label>
      <select
        id="org-switcher"
        value={activeId}
        disabled={pending}
        className="h-9 w-full rounded border border-border bg-surface px-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onChange={async (event) => {
          setPending(true);
          await fetch("/api/organizations/switch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ organizationId: event.target.value }),
          });
          router.refresh();
          setPending(false);
        }}
      >
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
