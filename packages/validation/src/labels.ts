/** Plain data (no zod) so client components can import it without pulling validation code into the bundle. */
export const TEMPLATE_CATEGORIES = [
  "newsletter",
  "announcement",
  "event",
  "startup",
  "product_launch",
  "welcome",
  "investor",
  "corporate",
  "marketing",
  "recruitment",
  "other",
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  newsletter: "Bülten",
  announcement: "Duyuru",
  event: "Etkinlik",
  startup: "Girişim",
  product_launch: "Ürün lansmanı",
  welcome: "Hoş geldin",
  investor: "Yatırımcı",
  corporate: "Kurumsal",
  marketing: "Pazarlama",
  recruitment: "İşe alım",
  other: "Diğer",
};
