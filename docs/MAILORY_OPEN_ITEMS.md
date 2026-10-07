# Mailory — Açık Konular ve Otonom Kararlar

Bu dosya, geliştirme sırasında **kullanıcıya sormadan** verilen/önerilen kararları ve **insan gerektiren** adımları biriktirir.
Her madde: ne yaptım (öneri), neden, kullanıcının yapması/onaylaması gereken ne var. Proje sonunda kullanıcıya özetlenir.

## A. İnsan gerektiren adımlar (yapılmadan canlıya çıkılamaz)

| #   | Konu                   | Gerekli eylem                                                                                                                                                                                                                       | Faz |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| A1  | Amazon SES             | Hesap, production access (sandbox çıkışı), yapılandırma seti + SNS topic + `/api/webhooks/ses` HTTPS aboneliği                                                                                                                      | 8   |
| A2  | `DOMAIN_PROVIDER=ses`  | Gerçek `CreateEmailIdentity`/DKIM okuması stub; canlı SES ile duman testi yapılmadı                                                                                                                                                 | 6/8 |
| A3  | DNS                    | `mailory.io` (uygulama) alan adı ve (isteğe bağlı) özel izleme alan adı                                                                                                                                                             | 16  |
| A4  | Railway                | Ayrı proje, servisler, değişkenler (runbook Faz 16'da)                                                                                                                                                                              | 16  |
| A5  | Hukuki                 | KVKK aydınlatma, gizlilik politikası, kullanım şartları, izleme (piksel/tıklama) açıklaması — hukuki görüş                                                                                                                          | 15  |
| A6  | BTM verisi             | Mevcut SendPulse listelerinin CSV'si (izin kayıtlarıyla birlikte)                                                                                                                                                                   | 17  |
| A10 | Platform yöneticisi    | İlk yönetici: kayıt olduktan sonra `pnpm --filter @mailory/db platform-admin <e-posta>`; BTM'yi oluşturmak için /platform'dan partner kurum aç (veya mevcut org'u partner yap). Destek erişimi (impersonation) için politika kararı | 13  |
| A9  | Plan limitleri / fiyat | Plan sayıları (free 500 kişi/1000 e-posta … btm_sponsored 5000/15000) benim hipotezim; iş modeli kararı + ödeme sağlayıcısı (Stripe/iyzico) sözleşmesi gerekir                                                                      | 14  |
| A8  | Yapay zekâ             | `ANTHROPIC_API_KEY` ekleyip `AI_PROVIDER=anthropic` ile canlı duman testi; veri işleme (üçüncü taraf model) bilgilendirmesi hukuki metinlere eklenmeli                                                                              | 12  |
| A7  | E-posta istemci testi  | Outlook/Gmail/Apple Mail render geçişi (Litmus/Email on Acid)                                                                                                                                                                       | 5   |
| A11 | KVKK hukuki metinler   | Aydınlatma metni, gizlilik politikası, veri işleme sözleşmesi (BTM ve girişimciler için), saklama sürelerinin (D-093) metne işlenmesi, VERBİS değerlendirmesi, alt işleyenler (Amazon SES, Anthropic, Railway) listesi              | 15  |

## B. Otonom verilen kararlar / öneriler (uygulandı, onayına açık)

| #   | Karar                                                                                                                                        | Gerekçe                                                    | Faz |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --- |
| B1  | Yeni çalışma alanı günlük gönderim sınırı varsayılanı 2000                                                                                   | Isınma; platform yöneticisi yükseltir                      | 8   |
| B3  | Deliverability eşikleri (bounce %2/%5, şikayet %0,1/%0,3) ve skor ağırlıkları benim önerim; gerçek verilerle kalibre edilmeli                | Sektör pratiği + SES hesap sağlığı eşikleri                | 10  |
| B4  | Etkileşim skoru formülü (açılma %50 + tıklama×3 %50, 90 gün) benim önerim                                                                    | Açılma Apple MPP ile şişer; tıklama ağırlıklı              | 10  |
| B5  | Otomasyon: kişi başına tek giriş, terminal dallar, yalnızca etkinleştirme sonrası tetiklenenler, liste tabanlı oluşturucu (görsel tuval yok) | Güvenlik ve basitlik                                       | 11  |
| B6  | AI varsayılan kapalı + org başına açma onayı; varsayılan model Haiku 4.5 (maliyet); günlük 50 istek/org                                      | KVKK ve maliyet kontrolü                                   | 12  |
| B7  | Aboneliği olmayan org = free plan; plan düşürme veri silmez; limit dolunca kampanya duraklar ve limit artınca kendiliğinden devam eder       | Veriyi cezalandırmadan koru                                | 14  |
| B8  | Partner yetki tavanı = pro plan değerleri; partner çocuk org'a üye olmaz (girişimci owner olur); partner sponsorluk bütçesi yok              | Hesap ele geçirme riskini sınırla, D-007'yi koru           | 13  |
| B2  | Onay politikasında sahipler dahi kendi gönderdiğini onaylayamaz                                                                              | Dört göz ilkesi; tek yöneticili org kendini kilitleyebilir | 7   |
| B9  | Saklama süreleri: izleme 25 ay (bot 30 gün), sağlayıcı olayı/AI günlüğü 13 ay, oturum/token/outbox 30 gün; org silme 30 gün tolerans         | KVKK minimizasyonu; hukuk onayı gerekir                    | 15  |
| B10 | Next.js 16.3.6'ya yükseltme (güvenlik); esbuild (dev aracı) bulgusu kabul edildi                                                             | Üretime girmez                                             | 15  |

## C. Ertelenen / kapsam dışı bırakılanlar (neden + öneri)

| #   | Konu                                                                        | Neden                                                                    | Öneri                           |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------- |
| C2  | Google Postmaster/SNDS entegrasyonu, seed-list testi                        | Dış hesap/ücretli hizmet gerektirir                                      | Pilot sonrası                   |
| C3  | Görsel akış tuvali, birleşen dallar, ek tetikleyici/eylemler, yeniden giriş | Kapsam; V2.1                                                             | 11+                             |
| C4  | Impersonation/destek oturumu, sponsorluk bütçesi ve kullanım raporu         | Güvenlik tasarımı gerekir                                                | 13+                             |
| C1  | PDF rapor dışa aktarma                                                      | CSV yeterli; PDF için ek bağımlılık                                      | İhtiyaç doğunca                 |
| C5  | Postgres RLS                                                                | Bileşik FK + uygulama katmanı yeterli (D-089); havuz/worker karmaşıklığı | Pilot sonrası, gerçek ihtiyaçta |
| C6  | Org'un tüm verisinin dışa aktarımı (taşınabilirlik)                         | Kişi bazlı dışa aktarma var; toplu paket kapsam dışı                     | Talep gelince                   |

## D. Altyapı notları

- GitHub push'u 2026-10-07 15:10 UTC'de geçici `500 Internal Server Error` verdi (Faz 10 commit'i yerelde); sonraki push'larda yeniden denendi (bkz. git log / son durum).
