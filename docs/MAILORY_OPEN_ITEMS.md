# Mailory — Açık Konular ve Otonom Kararlar

Bu dosya, geliştirme sırasında **kullanıcıya sormadan** verilen/önerilen kararları ve **insan gerektiren** adımları biriktirir.
Her madde: ne yaptım (öneri), neden, kullanıcının yapması/onaylaması gereken ne var. Proje sonunda kullanıcıya özetlenir.

## A. İnsan gerektiren adımlar (yapılmadan canlıya çıkılamaz)

| #   | Konu                  | Gerekli eylem                                                                                                                                          | Faz |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| A1  | Amazon SES            | Hesap, production access (sandbox çıkışı), yapılandırma seti + SNS topic + `/api/webhooks/ses` HTTPS aboneliği                                         | 8   |
| A2  | `DOMAIN_PROVIDER=ses` | Gerçek `CreateEmailIdentity`/DKIM okuması stub; canlı SES ile duman testi yapılmadı                                                                    | 6/8 |
| A3  | DNS                   | `mailory.io` (uygulama) alan adı ve (isteğe bağlı) özel izleme alan adı                                                                                | 16  |
| A4  | Railway               | Ayrı proje, servisler, değişkenler (runbook Faz 16'da)                                                                                                 | 16  |
| A5  | Hukuki                | KVKK aydınlatma, gizlilik politikası, kullanım şartları, izleme (piksel/tıklama) açıklaması — hukuki görüş                                             | 15  |
| A6  | BTM verisi            | Mevcut SendPulse listelerinin CSV'si (izin kayıtlarıyla birlikte)                                                                                      | 17  |
| A8  | Yapay zekâ            | `ANTHROPIC_API_KEY` ekleyip `AI_PROVIDER=anthropic` ile canlı duman testi; veri işleme (üçüncü taraf model) bilgilendirmesi hukuki metinlere eklenmeli | 12  |
| A7  | E-posta istemci testi | Outlook/Gmail/Apple Mail render geçişi (Litmus/Email on Acid)                                                                                          | 5   |

## B. Otonom verilen kararlar / öneriler (uygulandı, onayına açık)

| #   | Karar                                                                                                                                        | Gerekçe                                                    | Faz |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --- |
| B1  | Yeni çalışma alanı günlük gönderim sınırı varsayılanı 2000                                                                                   | Isınma; platform yöneticisi yükseltir                      | 8   |
| B3  | Deliverability eşikleri (bounce %2/%5, şikayet %0,1/%0,3) ve skor ağırlıkları benim önerim; gerçek verilerle kalibre edilmeli                | Sektör pratiği + SES hesap sağlığı eşikleri                | 10  |
| B4  | Etkileşim skoru formülü (açılma %50 + tıklama×3 %50, 90 gün) benim önerim                                                                    | Açılma Apple MPP ile şişer; tıklama ağırlıklı              | 10  |
| B5  | Otomasyon: kişi başına tek giriş, terminal dallar, yalnızca etkinleştirme sonrası tetiklenenler, liste tabanlı oluşturucu (görsel tuval yok) | Güvenlik ve basitlik                                       | 11  |
| B6  | AI varsayılan kapalı + org başına açma onayı; varsayılan model Haiku 4.5 (maliyet); günlük 50 istek/org                                      | KVKK ve maliyet kontrolü                                   | 12  |
| B2  | Onay politikasında sahipler dahi kendi gönderdiğini onaylayamaz                                                                              | Dört göz ilkesi; tek yöneticili org kendini kilitleyebilir | 7   |

## C. Ertelenen / kapsam dışı bırakılanlar (neden + öneri)

| #   | Konu                                                                        | Neden                               | Öneri           |
| --- | --------------------------------------------------------------------------- | ----------------------------------- | --------------- |
| C2  | Google Postmaster/SNDS entegrasyonu, seed-list testi                        | Dış hesap/ücretli hizmet gerektirir | Pilot sonrası   |
| C3  | Görsel akış tuvali, birleşen dallar, ek tetikleyici/eylemler, yeniden giriş | Kapsam; V2.1                        | 11+             |
| C1  | PDF rapor dışa aktarma                                                      | CSV yeterli; PDF için ek bağımlılık | İhtiyaç doğunca |

## D. Altyapı notları

- GitHub push'u 2026-10-07 15:10 UTC'de geçici `500 Internal Server Error` verdi (Faz 10 commit'i yerelde); sonraki push'larda yeniden denendi (bkz. git log / son durum).
