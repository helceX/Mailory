"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, Wordmark } from "@mailory/ui";
import { NAV_ITEMS } from "./nav-config";

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-surface md:flex md:flex-col">
      <div className="flex h-16 items-center px-5">
        <Link href="/dashboard" aria-label="Mailory dashboard" className="text-lg">
          <Wordmark />
        </Link>
      </div>
      <nav
        className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4"
        aria-label="Primary"
      >
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors duration-150",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
