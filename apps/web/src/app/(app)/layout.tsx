import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { getOrgContext } from "@/lib/org/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await getOrgContext();
  if (!context) redirect("/login");
  if (!context.organization) redirect("/onboarding");

  const organizations = context.memberships.map((m) => ({
    id: m.organizationId,
    name: m.name,
  }));
  const activeOrganizationId = context.organization.organizationId;
  const extra: { href: string; label: string; key: "platform" }[] = [];
  if (context.user.isPlatformAdmin)
    extra.push({ href: "/platform", label: "Platform", key: "platform" });

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        İçeriğe geç
      </a>
      <AppSidebar
        userName={`${context.user.firstName} ${context.user.lastName}`}
        organizations={organizations}
        activeOrganizationId={activeOrganizationId}
        extra={extra}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav
          organizations={organizations}
          activeOrganizationId={activeOrganizationId}
          extra={extra}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-4 py-6 outline-none md:px-8 md:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
