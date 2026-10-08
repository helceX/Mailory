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
    | "recruitment"
    | "ecommerce"
    | "customer";
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

  {
    key: "sale",
    name: "İndirim kampanyası",
    category: "ecommerce",
    description: "Süreli indirimi kod, avantajlar ve tek bir net çağrıyla duyurun.",
    build: (brand) =>
      shell(brand, "Sınırlı süre: indirim sizi bekliyor", [
        heading("%20 indirim, sadece bu hafta", 1, "center"),
        para(
          "Merhaba {{first_name|merhaba}},\n\nBeğendiğiniz ürünlerde sınırlı süreli indirim başladı. Aşağıdaki kodu ödeme adımında girmeniz yeterli.",
        ),
        heading("KOD: INDIRIM20", 2, "center"),
        button("Alışverişe başla", "https://example.com", "center"),
        spacer(8),
        columns(
          [heading("Ücretsiz kargo", 3), para("500 TL üzeri siparişlerde.")],
          [heading("Kolay iade", 3), para("14 gün içinde ücretsiz iade.")],
        ),
        spacer(8),
        para("Kampanya stoklarla sınırlıdır; bitiş tarihini buraya yazın."),
      ]),
  },
  {
    key: "new-collection",
    name: "Yeni koleksiyon",
    category: "ecommerce",
    description: "Yeni gelen ürünleri üç sütunda tanıtın.",
    build: (brand) =>
      shell(brand, "Yeni koleksiyon yayında", [
        heading("Yeni koleksiyon yayında"),
        para(
          "Merhaba {{first_name|merhaba}}, bu sezonun öne çıkan ürünlerine göz atın.",
        ),
        columns(
          [heading("Ürün 1", 3), para("Kısa açıklama.")],
          [heading("Ürün 2", 3), para("Kısa açıklama.")],
          [heading("Ürün 3", 3), para("Kısa açıklama.")],
        ),
        spacer(8),
        button("Koleksiyonu keşfet"),
      ]),
  },
  {
    key: "win-back",
    name: "Sizi özledik",
    category: "customer",
    description: "Bir süredir etkileşimde olmayan kişilere geri dönüş daveti.",
    build: (brand) =>
      shell(brand, "Sizi özledik", [
        heading("Sizi özledik, {{first_name|dostum}}"),
        para(
          "Bir süredir görüşemedik. Bu arada {{org_name}} tarafında neler değişti, kısaca anlatalım.",
        ),
        para("• Yenilik 1\n• Yenilik 2\n• Yenilik 3"),
        button("Geri dön"),
        spacer(8),
        para(
          "Artık e-posta almak istemiyorsanız aşağıdaki bağlantıyla ayrılabilirsiniz; hiçbir şey kaybetmezsiniz.",
        ),
      ]),
  },
  {
    key: "feedback-survey",
    name: "Geri bildirim anketi",
    category: "customer",
    description: "Kısa bir anket için kişiyi nazikçe davet edin.",
    build: (brand) =>
      shell(brand, "Görüşünüz bizim için değerli", [
        heading("Görüşünüz bizim için değerli"),
        para(
          "Merhaba {{first_name|merhaba}},\n\n{{org_name}} deneyiminizi iyileştirmek istiyoruz. 2 dakikanızı ayırıp kısa anketimizi yanıtlar mısınız?",
        ),
        button("Ankete katıl"),
        spacer(8),
        para("Yanıtlarınız yalnızca hizmetimizi geliştirmek için kullanılır."),
      ]),
  },
  {
    key: "webinar",
    name: "Webinar daveti",
    category: "event",
    description: "Çevrim içi etkinlik: tarih, konuşmacı ve kayıt çağrısı.",
    build: (brand) =>
      shell(brand, "Ücretsiz webinara davetlisiniz", [
        heading("Ücretsiz webinara davetlisiniz"),
        para(
          "Merhaba {{first_name|merhaba}}, konuyu uzmanlarından dinlemek için bize katılın.",
        ),
        columns(
          [heading("Tarih", 3), para("00 Ay, 00:00")],
          [heading("Konuşmacı", 3), para("Ad Soyad, Unvan")],
        ),
        spacer(8),
        heading("Neler öğreneceksiniz?", 2),
        para("• Konu 1\n• Konu 2\n• Konu 3"),
        button("Yerimi ayır"),
      ]),
  },
  {
    key: "thank-you",
    name: "Teşekkür",
    category: "customer",
    description: "Müşteri veya katılımcıya içten bir teşekkür ve sonraki adım.",
    build: (brand) =>
      shell(brand, "Teşekkür ederiz", [
        heading("Teşekkür ederiz, {{first_name|dostum}}!"),
        para(
          "Bizi tercih ettiğiniz için çok teşekkür ederiz. Sizinle çalışmak bizim için gerçek bir memnuniyet.",
        ),
        para("Bir sonraki adımda sizi bekleyen şey:"),
        button("Devam et"),
      ]),
  },
  {
    key: "holiday",
    name: "Bayram / yılbaşı tebriği",
    category: "corporate",
    description: "Kurumsal bir tebrik mesajı; tatil günlerini de duyurur.",
    build: (brand) =>
      shell(brand, "Mutlu bayramlar", [
        heading("Mutlu bayramlar!", 1, "center"),
        para(
          "Sevgili {{first_name|dostumuz}},\n\n{{org_name}} ekibi olarak sizin ve sevdiklerinizin bayramını kutlar, sağlık ve huzur dolu günler dileriz.",
        ),
        divider(),
        para("Ofisimiz 00–00 Ay tarihleri arasında kapalı olacaktır."),
      ]),
  },
  {
    key: "press-release",
    name: "Basın bülteni",
    category: "announcement",
    description: "Medyaya ve paydaşlara resmi haber: özet, detay ve iletişim.",
    build: (brand) =>
      shell(brand, "Basın bülteni", [
        heading("Haber başlığı buraya"),
        para(
          "**Şehir, 00 Ay 0000** — Haberin en önemli cümlesi: kim, ne, ne zaman, neden.",
        ),
        para("Detay paragrafı. Önemli rakamları ve alıntıları ekleyin."),
        quote("Yetkili alıntısı buraya.", "Ad Soyad, Unvan"),
        heading("Basın iletişim", 2),
        para("Ad Soyad · ornek@firma.com · +90 000 000 00 00"),
      ]),
  },
  {
    key: "weekly-digest",
    name: "Haftalık özet",
    category: "newsletter",
    description: "Haftanın üç önemli içeriğini kısa kısa derleyin.",
    build: (brand) =>
      shell(brand, "Bu haftanın öne çıkanları", [
        heading("Bu haftanın öne çıkanları"),
        para("Merhaba {{first_name|merhaba}}, haftanın en önemli üç başlığı:"),
        heading("1. Başlık", 2),
        para("Kısa özet. Devamı için bağlantıya tıklayın."),
        heading("2. Başlık", 2),
        para("Kısa özet. Devamı için bağlantıya tıklayın."),
        heading("3. Başlık", 2),
        para("Kısa özet. Devamı için bağlantıya tıklayın."),
        button("Tümünü oku"),
      ]),
  },
  {
    key: "course-launch",
    name: "Eğitim / kurs duyurusu",
    category: "marketing",
    description: "Yeni bir eğitimi içerik, kazanım ve kayıt çağrısıyla tanıtın.",
    build: (brand) =>
      shell(brand, "Yeni eğitim için kayıtlar açıldı", [
        heading("Yeni eğitim için kayıtlar açıldı"),
        para(
          "Merhaba {{first_name|merhaba}},\n\nBeklenen eğitimimiz başlıyor. Kontenjan sınırlıdır.",
        ),
        columns(
          metric("0 hafta", "Süre"),
          metric("0 ders", "İçerik"),
          metric("Sertifika", "Bitirenlere"),
        ),
        spacer(8),
        heading("Bu eğitimde neler var?", 2),
        para("• Modül 1\n• Modül 2\n• Modül 3"),
        button("Kayıt ol"),
      ]),
  },
  {
    key: "referral",
    name: "Arkadaşını getir",
    category: "marketing",
    description: "Tavsiye programını basit bir ödül anlatımıyla duyurun.",
    build: (brand) =>
      shell(brand, "Arkadaşlarınızı getirin, birlikte kazanın", [
        heading("Arkadaşlarınızı getirin, birlikte kazanın"),
        para(
          "Merhaba {{first_name|merhaba}},\n\n{{org_name}} sizin için değerliyse, arkadaşlarınız için de olabilir. Davet ettiğiniz her kişi için ikiniz de ödül kazanırsınız.",
        ),
        columns(
          [heading("1", 2), para("Bağlantınızı paylaşın")],
          [heading("2", 2), para("Arkadaşınız kaydolsun")],
          [heading("3", 2), para("İkiniz de kazanın")],
        ),
        spacer(8),
        button("Davet bağlantımı al"),
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
