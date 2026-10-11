"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, Wordmark } from "@mailory/ui";
import { LogoutButton } from "./logout-button";
import { EXTRA_ICONS, NAV_ITEMS, type ExtraNav } from "./nav-config";
import { OrgSwitcher } from "./org-switcher";

/** Below `md` the sidebar is hidden; this compact header keeps every destination one tap away. */
export function MobileNav({
  organizations,
  activeOrganizationId,
  extra = [],
}: {
  organizations: { id: string; name: string }[];
  activeOrganizationId: string;
  extra?: ExtraNav[];
}) {
  const pathname = usePathname();
  return (
    <header className="border-b bg-surface md:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <Link href="/dashboard" aria-label="Mailory dashboard" className="text-lg">
          <Wordmark />
        </Link>
        <div className="min-w-0 flex-1">
          <OrgSwitcher organizations={organizations} activeId={activeOrganizationId} />
        </div>
        <LogoutButton compact />
      </div>
      <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-3 pb-2">
        {[
          ...NAV_ITEMS.map((i) => ({ ...i })),
          ...extra.map((e) => ({
            href: e.href,
            label: e.label,
            icon: EXTRA_ICONS[e.key],
          })),
        ].map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded px-3 py-2 text-sm font-medium",
                active ? "bg-secondary text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
