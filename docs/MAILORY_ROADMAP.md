# Mailory — Roadmap

Sıralama ilkesi (brief §70): çekirdek e-posta altyapısı → multi-tenant → UX → deliverability → analitik → otomasyon → AI → billing → entegrasyon.

| Milestone                         | Faz                  | Çıktı                                                                                                             | Bitiş ölçütü                                                  |
| --------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **M0**                            | 0 Discovery          | Bu dokümanlar                                                                                                     | Onaylı plan                                                   |
| **M1 "BTM, SendPulse'ı bırakır"** | 1–10 (V1 çekirdeği)  | Auth, org, RBAC, contacts/lists/segments, editör, domain, kampanya, SES hattı, tracking, analitik, deliverability | Gerçek kampanya SES'ten gider; bounce/complaint/unsub işlenir |
| **M2 "Girişimci workspace'leri"** | 13 + 14 (kısmi) + 17 | BTM Admin Panel, sponsored access, entitlement                                                                    | BTM yeni girişimci org'u açar, limit atar                     |
| **M3 "Gerçek SaaS"**              | 14, 15, 16, 18       | Self-serve kayıt, plan altyapısı, güvenlik sertleştirme, Railway prod                                             | Yabancı bir şirket kendi başına gönderir                      |
| **M4 "AI + deliverability"**      | 11, 12, V1.1         | Otomasyon, Copilot/Review/Analyst, Smart Resend/Send, A/B                                                         | Farklılaştırıcılar canlı                                      |

## Faz planı

| Faz | Kapsam                                                                                      | Çıkış koşulu                          |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------- |
| 0   | Audit + 7 doküman                                                                           | ✔                                    |
| 1   | Monorepo iskeleti, config, db bağlantısı, ui token/bileşenler, app shell, `/api/health`, CI | build/lint/typecheck/test yeşil       |
| 2   | Auth: signup/login/logout, doğrulama, parola sıfırlama, oturum, rate limit, CSRF            | auth testleri                         |
| 3   | Org + üyelik + davet + RBAC + audit log + aktif org + tenant-isolation test altyapısı       | cross-tenant testleri                 |
| 4   | Contacts, listeler, tag, custom field, CSV import/export, suppression, segment motoru       | 10K contact'ta hızlı                  |
| 5   | Template/editör, Brand Kit, template library, sürümleme                                     | render testleri                       |
| 6   | Sender identity + domain doğrulama + onboarding                                             | DNS kayıt akışı                       |
| 7   | Kampanya motoru (sihirbaz, durum makinesi, UTM, test gönderimi, planlama, onay)             | e2e kampanya oluşturma                |
| 8   | Kuyruk/worker/SES transport, retry, SNS webhook, unsubscribe                                | gönderim + event entegrasyon testleri |
| 9   | Tracking (open/click), analitik, dashboard, export                                          | analitik testleri                     |
| 10  | Deliverability Center, Campaign Health (kural tabanlı)                                      | skor + aksiyon listesi                |
| 11  | Otomasyon builder (V2)                                                                      |                                       |
| 12  | AI Copilot/Review/Analyst (V2)                                                              | onaysız gönderim yok testi            |
| 13  | BTM Admin, sponsored access, Platform Admin, BTM Template Hub                               | M2                                    |
| 14  | Plan/entitlement/usage uygulaması, sağlayıcı arayüzü                                        | entitlement testleri                  |
| 15  | Güvenlik/test sertleştirme, RLS, yük testi, KVKK akışları                                   |                                       |
| 16  | Railway deploy (runbook, health, loglar)                                                    | staging yeşil                         |
| 17  | BTM pilot canlı                                                                             |                                       |
| 18  | Herkese açık lansman, fiyat analizi, public API/webhook                                     |                                       |

## Pricing analizi (D-019, hipotez)

Maliyet tabanı SES (~$0.10/1000 e-posta) + depolama + Railway. Katman limitleri (contacts, aylık gönderim) tahmini marj ≥ %60 olacak şekilde Faz 14'te hesaplanır; BTM sponsorlu plan maliyeti BTM'ye kullanım raporu ile gösterilir. Fiyat hipotezi ve maliyet analizi Faz 18'de `docs/MAILORY_PRICING.md` olarak yazıldı; rakip fiyatları doğrulanmamış tahmindir ve yayından önce güncel veriyle kontrol edilmelidir.

## İnsan gerektiren adımlar (bloklayıcılar)

1. **SES hesabı + production access başvurusu** (hemen) · 2. Railway'de ayrı project + değişkenler · 3. `mailory.io` DNS (web, kayıtlar) · 4. SNS topic + HTTPS abonelik · 5. KVKK/gizlilik/şart metinleri için hukuki görüş · 6. BTM'nin mevcut SendPulse listelerinin CSV'si.
