import {
  createBlock,
  createEmptyDoc,
  logoSrcFor,
  settingsFromBrand,
  type BlockType,
  type BrandKit,
  type EmailDoc,
  type LeafBlock,
  type ColumnsBlock,
  type Block,
} from "@mailory/core/shared";

export type LibraryTemplate = {
  key: string;
  name: string;
  category:
    | "newsletter"
    | "announcement"
    | "event"
    | "startup"
    | "product_launch"
    | "welcome"
    | "investor"
    | "corporate"
    | "marketing"
    | "recruitment";
  description: string;
  build: (brand: BrandKit) => EmailDoc;
};

// ---- tiny builders ---------------------------------------------------------------------------------
const heading = (
  text: string,
  level: 1 | 2 | 3 = 1,
  align: "left" | "center" = "left",
): LeafBlock => ({
  ...(createBlock("heading") as Extract<LeafBlock, { type: "heading" }>),
  text,
  level,
  align,
});
const para = (text: string): LeafBlock => ({
  ...(createBlock("paragraph") as Extract<LeafBlock, { type: "paragraph" }>),
  text,
});
const button = (
  label: string,
  href = "https://example.com",
  align: "left" | "center" = "left",
): LeafBlock => ({
  ...(createBlock("button") as Extract<LeafBlock, { type: "button" }>),
  label,
  href,
  align,
});
const spacer = (height = 16): LeafBlock => ({
  ...(createBlock("spacer") as Extract<LeafBlock, { type: "spacer" }>),
  height,
});
const divider = (): LeafBlock => createBlock("divider") as LeafBlock;
const quote = (text: string, author = ""): LeafBlock => ({
  ...(createBlock("quote") as Extract<LeafBlock, { type: "quote" }>),
  text,
  author,
});
const columns = (...cols: LeafBlock[][]): ColumnsBlock => ({
  ...(createBlock("columns") as ColumnsBlock),
  columns: cols,
});
const metric = (value: string, label: string): LeafBlock[] => [
  heading(value, 2),
  para(label),
];

/** Every template opens with the brand logo (when one exists) and closes with the brand footer + social links. */
function shell(brand: BrandKit, preheader: string, body: Block[]): EmailDoc {
  const doc = createEmptyDoc({ ...settingsFromBrand(brand), preheader });
  if (brand.logoAssetId)
    doc.blocks.push(
      {
        ...(createBlock("logo") as Extract<LeafBlock, { type: "logo" }>),
        src: logoSrcFor(brand),
        alt: "{{org_name}}",
      },
      spacer(8) as Block,
    );
  doc.blocks.push(...body);
  if (brand.socialLinks.length)
    doc.blocks.push(spacer(8) as Block, {
      ...(createBlock("social") as Extract<LeafBlock, { type: "social" }>),
      links: brand.socialLinks,
      align: "center",
    });
  doc.blocks.push({
    ...(createBlock("footer") as Extract<LeafBlock, { type: "footer" }>),
    text:
      brand.footerText.trim() || "{{org_name}}\n{{current_year}} tüm hakları saklıdır.",
    showUnsubscribe: true,
  });
  return doc;
}

export const LIBRARY_TEMPLATES: LibraryTemplate[] = [
  {
    key: "newsletter",
    name: "Aylık bülten",
    category: "newsletter",
    description: "Haberler, öne çıkan içerik ve tek bir net eylem çağrısı.",
    build: (brand) =>
      shell(brand, "Bu ayın öne çıkanları", [
        heading("Bu ayın öne çıkanları"),
        para(
          "Merhaba {{first_name|değerli okuyucumuz}},\n\nBu ay sizin için bir araya getirdiğimiz gelişmeleri kısaca özetledik.",
        ),
        divider(),
        heading("Öne çıkan haber", 2),
        para(
          "Bu bölümde ayın en önemli gelişmesini 2–3 cümleyle anlatın. Okuyucuyu bir sonraki adıma yönlendirin.",
        ),
        button("Devamını oku"),
        spacer(8),
        divider(),
        heading("Kısaca", 2),
        para("• Birinci gelişme\n• İkinci gelişme\n• Üçüncü gelişme"),
      ]),
  },
  {
    key: "event",
    name: "Etkinlik duyurusu",
    category: "event",
    description: "Tarih, yer ve kayıt bağlantısıyla net bir etkinlik daveti.",
    build: (brand) =>
      shell(brand, "Sizi etkinliğimize bekliyoruz", [
        heading("Sizi etkinliğimize davet ediyoruz"),
        para(
          "Merhaba {{first_name|değerli katılımcımız}},\n\nEtkinliğimizin detayları aşağıda. Yerler sınırlı; kaydınızı şimdi oluşturun.",
        ),
        columns(
          [heading("Tarih", 3), para("26 Haziran, 14:00")],
          [heading("Yer", 3), para("Etkinlik mekanı, Şehir")],
        ),
        spacer(8),
        button("Kayıt ol", "https://example.com/kayit"),
        spacer(8),
        para("Sorularınız için bu e-postayı yanıtlayabilirsiniz."),
      ]),
  },
  {
    key: "welcome",
    name: "Hoş geldiniz",
    category: "welcome",
    description: "Yeni abonelere kısa, samimi bir karşılama ve ilk adım.",
    build: (brand) =>
      shell(brand, "Aramıza hoş geldiniz", [
        heading("Aramıza hoş geldiniz, {{first_name|dostum}}!"),
        para(
          "{{org_name}} topluluğuna katıldığınız için teşekkür ederiz. Size ne sıklıkla ve hangi konularda yazacağımızı baştan söyleyelim: ayda bir, yalnızca işinize yarayacak içerikler.",
        ),
        button("İlk adımı at"),
        spacer(8),
        para(
          "Beklentinizi karşılamıyorsak abonelikten dilediğiniz zaman çıkabilirsiniz.",
        ),
      ]),
  },
  {
    key: "investor-update",
    name: "Yatırımcı güncellemesi",
    category: "investor",
    description: "Üç temel metrik, kazanımlar ve yatırımcıdan beklenen destek.",
    build: (brand) =>
      shell(brand, "Bu çeyreğin özeti", [
        heading("Çeyrek güncellemesi"),
        para(
          "Merhaba {{first_name|değerli yatırımcımız}},\n\nBu çeyrekte neler yaptığımızı ve nelere ihtiyacımız olduğunu paylaşıyoruz.",
        ),
        columns(
          metric("%0", "Aylık gelir artışı"),
          metric("0", "Aktif müşteri"),
          metric("0 ay", "Nakit ömrü"),
        ),
        spacer(8),
        heading("Kazanımlar", 2),
        para("• Kazanım 1\n• Kazanım 2\n• Kazanım 3"),
        heading("Zorluklar", 2),
        para(
          "Şeffaf olmak istiyoruz: bu çeyrekte en çok zorlandığımız konular şunlardı…",
        ),
        heading("Sizden istediğimiz destek", 2),
        para(
          "Tanıştırma, geri bildirim veya fırsat: bu konuda yardımcı olabilecekseniz yanıtlamanız yeterli.",
        ),
      ]),
  },
  {
    key: "product-launch",
    name: "Ürün lansmanı",
    category: "product_launch",
    description: "Yeni ürün veya özelliği üç fayda ve tek buton ile duyurun.",
    build: (brand) =>
      shell(brand, "Yeni ürünümüz yayında", [
        heading("Yeni ürünümüz yayında", 1, "center"),
        para(
          "Merhaba {{first_name|merhaba}},\n\nUzun süredir üzerinde çalıştığımız yenilik artık herkesin kullanımına açık.",
        ),
        columns(
          [heading("Hızlı", 3), para("Kısa bir fayda cümlesi.")],
          [heading("Basit", 3), para("Kısa bir fayda cümlesi.")],
          [heading("Güvenli", 3), para("Kısa bir fayda cümlesi.")],
        ),
        spacer(8),
        button("Hemen deneyin", "https://example.com", "center"),
      ]),
  },
  {
    key: "announcement",
    name: "Kurumsal duyuru",
    category: "announcement",
    description: "Resmî bir gelişmeyi sade ve güven veren bir dille duyurun.",
    build: (brand) =>
      shell(brand, "Önemli bir duyurumuz var", [
        heading("Duyuru"),
        para(
          "Sayın {{first_name|paydaşımız}},\n\nSizi şu gelişme hakkında bilgilendirmek isteriz: …",
        ),
        quote("Kısa bir yönetici alıntısı veya kilit mesaj.", "Ad Soyad, Unvan"),
        para(
          "Daha fazla bilgi için aşağıdaki bağlantıyı inceleyebilir veya bu e-postayı yanıtlayabilirsiniz.",
        ),
        button("Ayrıntıları gör"),
      ]),
  },
  {
    key: "startup-news",
    name: "Girişim haberleri",
    category: "startup",
    description: "Girişimler ve ekosistem için kısa haber ve fırsat derlemesi.",
    build: (brand) =>
      shell(brand, "Ekosistemden haberler", [
        heading("Ekosistemden haberler"),
        para(
          "Merhaba {{first_name|girişimci}},\n\n{{company|Girişiminiz}} için bu haftaki fırsatları ve duyuruları derledik.",
        ),
        heading("Fırsat", 2),
        para(
          "Başvuru, hibe veya program duyurusunu buraya yazın. Son tarihi mutlaka ekleyin.",
        ),
        button("Başvur"),
        spacer(8),
        divider(),
        heading("Etkinlikler", 2),
        para("• Etkinlik 1 — tarih\n• Etkinlik 2 — tarih"),
      ]),
  },
  {
    key: "job-opening",
    name: "Açık pozisyon",
    category: "recruitment",
    description: "Açık bir pozisyonu rol, sorumluluk ve başvuru adımıyla duyurun.",
    build: (brand) =>
      shell(brand, "Ekibimize katılın", [
        heading("Ekibimize katılın"),
        para(
          "Merhaba {{first_name|merhaba}},\n\n{{org_name}} olarak yeni bir arkadaş arıyoruz.",
        ),
        heading("Pozisyon", 2),
        para("**Pozisyon adı** · Şehir / Uzaktan"),
        heading("Neler yapacaksınız?", 2),
        para("• Sorumluluk 1\n• Sorumluluk 2\n• Sorumluluk 3"),
        button("Başvur"),
      ]),
  },
];

export const BLANK_BLOCKS: BlockType[] = [];

export function findLibraryTemplate(key: string) {
  return LIBRARY_TEMPLATES.find((t) => t.key === key) ?? null;
}

/** A new blank template: brand styling, logo, and footer — ready for the user's own content. */
export function blankTemplate(brand: BrandKit): EmailDoc {
  return shell(brand, "", [heading("Başlık"), para("Metninizi buraya yazın.")]);
}
