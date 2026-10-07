import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CalendarDays,
  LayoutDashboard,
  LayoutTemplate,
  Mail,
  Palette,
  Building2,
  Handshake,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";

/** Only sections that exist are listed — no dead "coming soon" entries. Added per phase. */
export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/audience/contacts", label: "Kitle", icon: Users },
  { href: "/campaigns", label: "Kampanyalar", icon: Mail },
  { href: "/analytics", label: "Analitik", icon: BarChart3 },
  { href: "/deliverability", label: "Teslim edilebilirlik", icon: ShieldCheck },
  { href: "/automations", label: "Otomasyon", icon: Workflow },
  { href: "/templates", label: "Şablonlar", icon: LayoutTemplate },
  { href: "/brand-kit", label: "Marka kiti", icon: Palette },
  { href: "/settings/members", label: "Ayarlar", icon: Settings },
];

// Planned destinations (see docs/MAILORY_PRODUCT_SPEC.md); activated as each phase ships.
export const PLANNED_NAV: NavItem[] = [
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
];

/** Role-dependent destinations (platform admins, partner organizations); the server decides who gets them. */
export type ExtraNav = { href: string; label: string; key: "platform" | "partner" };
export const EXTRA_ICONS: Record<ExtraNav["key"], LucideIcon> = {
  platform: Building2,
  partner: Handshake,
};
