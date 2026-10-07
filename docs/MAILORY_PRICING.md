# MAILORY — Fiyatlandırma analizi (varsayım belgesi)

> **Durum:** Bu belge bir **hipotezdir**; ödeme sağlayıcısı, ticari model ve rakip fiyatları insan kararıdır (OPEN_ITEMS A9). Rakip fiyatları değişkendir ve burada **doğrulanmamış tahmin** olarak anılır; yayından önce güncel fiyat sayfalarından kontrol edilmelidir. Dolar/TL kurları da yayın anında güncellenmelidir.

## 1. Birim maliyet (Mailory’nin bir müşteriye maliyeti)

| Kalem                                              | Tahmini maliyet            | Not                                                                        |
| -------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| Amazon SES gönderimi                               | ≈ 0,10 USD / 1.000 e-posta | En büyük değişken kalem; ek: ekler/veri aktarımı (ihmal edilebilir)        |
| SES — ayrılmış IP (isteğe bağlı)                   | ≈ 15–25 USD / ay / IP      | Yalnızca çok yüksek hacimde gerekir; paylaşılan IP ile başlanır            |
| Altyapı (Railway: web + worker + Postgres + Redis) | ≈ 30–80 USD / ay sabit     | Kullanıma göre; 100k+ kişiye kadar tek makine ölçümleri `ARCHITECTURE §22` |
| Yapay zekâ (Haiku sınıfı model)                    | ≈ cent altı / istek        | Plan başına aylık istek sınırı maliyeti sınırlar (D-079)                   |
| Depolama (görseller, DB)                           | ihmal edilebilir           | `storage_mb` limiti                                                        |
| Ödeme komisyonu                                    | ≈ %3–4 + sabit             | Sağlayıcıya bağlı                                                          |
| Destek                                             | insan zamanı               | Asıl gizli maliyet; self-servis + şablon yanıtlar                          |

Çıkarım: bir e-posta başına maliyet ≈ 0,0001 USD. **10.000 e-posta ≈ 1 USD**, 250.000 e-posta ≈ 25 USD. Değişken maliyet düşük olduğundan fiyatın asıl dayanağı **değer/kolaylık** ve **kişi sayısı**dır; gönderim hacmi limiti ise kötüye kullanımı ve itibar riskini sınırlamak içindir.

## 2. Plan limitleri (mevcut tohum veri, migration 0010 + `api_requests`)

| Plan       | Kişi     | E-posta/ay | Üye      | Otomasyon | AI/ay    | Depolama | API/ay   |
| ---------- | -------- | ---------- | -------- | --------- | -------- | -------- | -------- |
| Ücretsiz   | 500      | 1.000      | 2        | 1         | 20       | 50 MB    | 0        |
| Starter    | 2.500    | 10.000     | 3        | 3         | 100      | 200 MB   | 1.000    |
| Growth     | 10.000   | 50.000     | 10       | 10        | 500      | 1 GB     | 10.000   |
| Pro        | 50.000   | 250.000    | 25       | 50        | 2.000    | 5 GB     | 100.000  |
| Enterprise | sınırsız | sınırsız   | sınırsız | sınırsız  | sınırsız | sınırsız | sınırsız |

## 3. Önerilen fiyat hipotezi (aylık, KDV hariç)

| Plan       | Öneri (USD) | Tam doluluk değişken maliyeti    | Brüt marj (yaklaşık) |
| ---------- | ----------- | -------------------------------- | -------------------- |
| Ücretsiz   | 0           | ≈ 0,1 USD                        | — (edinim maliyeti)  |
| Starter    | 15          | ≈ 1 USD + komisyon ≈ 1,5         | %80+                 |
| Growth     | 49          | ≈ 5 USD + AI ≈ 1 + komisyon ≈ 2  | %80                  |
| Pro        | 149         | ≈ 25 USD + AI ≈ 4 + komisyon ≈ 5 | %75                  |
| Enterprise | teklif      | ayrılmış IP + destek             | pazarlık             |

Gerekçeler:

- **Kişi sayısı** fiyat eksenidir (rakiplerin çoğu böyle fiyatlar); e-posta/ay limiti ise “makul kullanım” tavanıdır — bir kişiye ayda ≈ 4 e-posta oranı (Starter 10.000/2.500) normal pazarlama kullanımını karşılar.
- Ücretsiz plan **gerçek gönderim** içerir ama küçük (1.000/ay) → deneme yapılabilir, kötüye kullanım ekonomisi zayıf; yeni hesaplar zaten günlük 2.000 e-posta ısınma sınırıyla başlar (B1).
- Yıllık ödemede ≈ %15–20 indirim önerilir (nakit akışı).
- Türkiye için TL fiyat listesi ve KDV/fatura süreci (e-Arşiv) ayrı karar; kur riski için TL fiyatı çeyreklik güncellenebilir.
- **Aşım davranışı:** hard-stop (mevcut): sınıra gelince gönderim durur, limit artınca/ay dönünce sürer; kullanıcı veri kaybetmez (D-082). Kullanım başına ek ücret (overage) ödeme sağlayıcısı entegrasyonundan sonra düşünülebilir.

## 4. Kıyas (doğrulanmamış, yön gösterici)

Pazarda benzer ölçekli kişi sayısı için tipik aylık fiyatlar: giriş planları ≈ 10–20 USD, orta planlar ≈ 40–80 USD, büyük planlar ≈ 150+ USD (Mailchimp, Brevo, SendPulse, MailerLite benzeri). Mailory’nin farklılaşması: Türkçe-öncelikli arayüz/şablonlar, KVKK akışları, yerel destek, **BTM gibi kurumlar için sponsorlu çok-kiracılı model**. Hipotez: Starter/Growth fiyatları rakiplerin giriş/orta planlarının biraz altı veya eşiti olacak şekilde konumlanır; fiyat rekabeti yerine **teslim edilebilirlik şeffaflığı ve kolaylık** öne çıkarılır.

## 5. Ölçülecekler (pilot sonrası kalibrasyon)

1. Gerçek ortalama “kişi başına aylık e-posta” (limit oranını doğrular).
2. Plan başına limit kullanım yüzdesi (hangi limite ilk çarpılıyor? yükseltme tetikleyicisi).
3. Destek talebi/müşteri ve bounce/şikayet oranı (itibar maliyeti).
4. API kullanım dağılımı (1.000/10.000/100.000 eşikleri doğru mu).
5. Ücretsiz → ücretli plana dönüşüm oranı.

## 6. Ödeme entegrasyonu — kapsam dışı (insan kararı)

Plan ataması bugün platform yöneticisi tarafından yapılır (`subscriptions.source`: `manual`). Stripe/iyzico/PayTR entegrasyonu için: sözleşme, webhook ile abonelik durumu → `subscriptions` eşlemesi (şema hazır: `source` içinde `stripe` değeri ve `status`; sağlayıcı kimliği alanı eklenecek), fatura bilgileri, vergi. Önerilen sıra: (1) fiyat kararı, (2) sağlayıcı seçimi, (3) checkout + webhook + `past_due` → askıya alma politikası.
