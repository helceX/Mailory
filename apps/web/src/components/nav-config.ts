import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CalendarDays,
  LayoutDashboard,
  Mail,
  Palette,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";

/** Only sections that exist are listed — no dead "coming soon" entries. Added per phase. */
export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/settings/members", label: "Ayarlar", icon: Settings },
];

// Planned destinations (see docs/MAILORY_PRODUCT_SPEC.md); activated as each phase ships.
export const PLANNED_NAV: NavItem[] = [
  { href: "/campaigns", label: "Campaigns", icon: Mail },
  { href: "/audience", label: "Audience", icon: Users },
  { href: "/automation", label: "Automation", icon: Workflow },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/deliverability", label: "Deliverability", icon: ShieldCheck },
  { href: "/brand-kit", label: "Brand Kit", icon: Palette },
];
