export const CAMPAIGN_PLAYBOOKS = {
  first_sale: {
    title: "İlk satış",
    goal: "purchase",
    subject: "Size uygun bir başlangıç",
    heading: "Birlikte başlayalım",
    action: "Teklifi incele",
    description: "Tek bir faydayı ve satın alma adımını öne çıkarır.",
  },
  demo: {
    title: "Demo talebi",
    goal: "demo_request",
    subject: "Kısa bir görüşmede birlikte inceleyelim",
    heading: "İhtiyacınıza nasıl yardımcı olabiliriz?",
    action: "Görüşme planla",
    description: "Ürün anlatımı yerine net bir görüşme çağrısı sunar.",
  },
  reactivation: {
    title: "Yeniden etkinleştirme",
    goal: "reactivated",
    subject: "Yeniden görüşmek isteriz",
    heading: "Sizin için yeni bir başlangıç",
    action: "Yenilikleri gör",
    description:
      "Abone kalmış kişilere geri dönme nedeni sunar; abonelikten çıkanları hedeflemez.",
  },
} as const;
export type CampaignPlaybookKind = keyof typeof CAMPAIGN_PLAYBOOKS;
export type CampaignPlaybookInput = {
  kind: CampaignPlaybookKind;
  proposition: string;
  actionUrl: string;
  measureImpact: boolean;
};

export function impactNextAction(status: string, controlPercent = 20) {
  switch (status) {
    case "collecting":
      return "Ölçüm bitişini bekleyin; erken görünen farkı kazanan ilan etmeyin.";
    case "compromised":
      return "Çakışan gönderimleri ve veri kaynağını inceleyin; sonraki ölçümü ayrı bir takvimde planlayın.";
    case "insufficient":
      return `Her grupta en az 50 kişi için yaklaşık ${Math.ceil((50 * 100) / controlPercent)} uygun kişi gerekir. Hedef olay kaynağını da kontrol edin; bu sayı tek başına yeterli ölçüm garantisi değildir.`;
    case "positive":
      return "Bu teklif için pozitif bir sinyal var. Aynı hedefle yeni bir ölçümde sonucu doğrulayın; bütçeyi otomatik artırmayın.";
    case "negative":
      return "Aynı gönderimi tekrarlamadan önce teklif ve hedef kitleyi gözden geçirin; yeni bir taslakta farklı bir yaklaşım deneyin.";
    default:
      return "Net bir yön bulunamadı. Sonraki kampanyada tek bir değişkeni değiştirerek karşılaştırmayı sürdürün.";
  }
}
