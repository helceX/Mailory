"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@mailory/ui";

const TABS = [
  { href: "/audience/contacts", label: "Kişiler" },
  { href: "/audience/lists", label: "Listeler" },
  { href: "/audience/segments", label: "Segmentler" },
  { href: "/audience/tags", label: "Etiketler" },
  { href: "/audience/fields", label: "Özel alanlar" },
  { href: "/audience/suppression", label: "Bastırma listesi" },
];

export function AudienceTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Kitle" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
