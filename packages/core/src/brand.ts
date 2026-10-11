import {
  DEFAULT_SETTINGS,
  type EmailSettings,
  type FontKey,
  type SocialNetwork,
} from "./email-doc";

/** An organization's visual identity (docs/MAILORY_PRODUCT_SPEC.md "Brand Kit"). Applied when a template is created. */
export type BrandKit = {
  logoAssetId: string | null;
  primaryColor: string;
  textColor: string;
  backgroundColor: string;
  linkColor: string;
  buttonColor: string;
  buttonTextColor: string;
  font: FontKey;
  buttonRadius: number;
  footerText: string;
  socialLinks: { network: SocialNetwork; url: string }[];
};

export const DEFAULT_BRAND: BrandKit = {
  logoAssetId: null,
  primaryColor: DEFAULT_SETTINGS.buttonColor,
  textColor: DEFAULT_SETTINGS.textColor,
  backgroundColor: DEFAULT_SETTINGS.contentBackground,
  linkColor: DEFAULT_SETTINGS.linkColor,
  buttonColor: DEFAULT_SETTINGS.buttonColor,
  buttonTextColor: DEFAULT_SETTINGS.buttonTextColor,
  font: DEFAULT_SETTINGS.font,
  buttonRadius: DEFAULT_SETTINGS.radius,
  footerText: "",
  socialLinks: [],
};

export function settingsFromBrand(brand: BrandKit): Partial<EmailSettings> {
  return {
    textColor: brand.textColor,
    headingColor: brand.textColor,
    linkColor: brand.linkColor,
    buttonColor: brand.buttonColor,
    buttonTextColor: brand.buttonTextColor,
    contentBackground: brand.backgroundColor,
    radius: brand.buttonRadius,
    font: brand.font,
  };
}

export const logoSrcFor = (brand: BrandKit) =>
  brand.logoAssetId ? `/a/${brand.logoAssetId}` : "";
