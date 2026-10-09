# Mailory — Product Spec

## Vizyon

Kullanıcının başka araca geçmeden **kayıt → marka → domain → contact → template → kampanya (AI yardımı) → test → planla → SES ile gönder → AI analizi → sonraki öneri** akışını tamamladığı, modern ve AI destekli e-posta pazarlama platformu. Konumlandırma: Mailchimp/SendPulse alternatifi + deliverability odağı + AI Marketing Copilot + BTM girişimci ekosistemi.

## Kullanıcılar ve roller

| Rol                 | Kapsam                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Platform Admin      | Tüm org'lar, planlar, kullanım, sistem sağlığı, SES/kuyruk durumu (içerik değil: destek amaçlı erişim audit'lidir) |
| Owner               | Org'un her şeyi: üyeler, domain, abonelik, silme                                                                   |
| Admin               | Üyeler hariç sahiplik işleri dışında her şey; kampanya onayı                                                       |
| Editor              | Contact, template, kampanya, analitik; gönderim için onay gerekebilir                                              |
| Viewer              | Salt okuma                                                                                                         |
| Partner Admin (BTM) | Kendi org'u + çocuk org'ların **kullanım/durum** görünümü, erişim/plan/limit atama                                 |

## Farklılaştırıcı değer (brief §45 soruları)

| Özellik                          | Mailchimp/SendPulse | Mailory yaklaşımı                                                 | Satış argümanı                              |
| -------------------------------- | ------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| Deliverability Center            | Sınırlı/ayrı        | SPF/DKIM/DMARC adım adım + skor + aksiyon                         | "Maillerin neden spam'e düştüğünü görürsün" |
| AI Campaign Review               | Yok/basit           | Gönderim öncesi 0–100 sağlık skoru + düzeltme                     | Hatalı gönderimi önler                      |
| Smart Resend                     | Kısmi               | Açmayanlara farklı konu/saatle tek tık                            | Tek tıkla %10–20 ek erişim                  |
| Engagement Score + Smart Segment | Var, karmaşık       | Her contact'a açıklanabilir skor, segmentte filtre                | Segment kurmak 1 adım                       |
| Brand Kit                        | Var                 | Onboarding'de bir kez; yeni mail hazır marka ile açılır           | Girişimci için "ilk mail 10 dk"             |
| BTM Template Hub                 | Yok                 | Kurumdan çocuk org'lara paylaşılan şablonlar (veri paylaşımı yok) | BTM→girişimci değeri                        |
| Sponsored access                 | Yok                 | Partner'ın alt org'lara limit/plan ataması                        | Kurumsal/Startup programı                   |

## V1 kapsamı (Milestone 1–3)

Auth, org, RBAC, contacts (CSV import/export, tags, listeler, custom field, consent), segmentler, template editörü + Brand Kit, sender domain doğrulama, kampanya (draft→review→scheduled→sending→sent), test gönderimi, SES gönderimi (kuyruk/worker), unsubscribe + suppression, bounce/complaint işleme, temel analitik + link analitiği + UTM, audit log, dashboard, onboarding, BTM Admin Panel (sponsored access), plan/entitlement altyapısı, `/api/health`.

## V1.1

A/B test, Smart Resend, Campaign Calendar, approval workflow, Deliverability Center skorları, Smart Send Time (basit istatistik), rapor dışa aktarma (CSV/PDF).

## V2

Otomasyon builder, Forms, AI Copilot/Review/Analyst/Subject Optimizer, API anahtarları + public REST + webhook, Stripe/iyzico, BTM Network, delegated access.
**Kapsam dışı:** SMS, WhatsApp, CRM, chatbot, sosyal medya yönetimi, landing page builder (mimari genişlemeye açık bırakılır).

## Kritik kullanıcı akışları

1. **İlk mail ≤ 7 adım:** kayıt → org → gönderici (+domain) → CSV → şablon → kampanya → gönder. Onboarding "4/7" ilerleme göstergeli; domain doğrulanmadan **test gönderimi** (platform alan adından) mümkündür, gerçek gönderim doğrulama ister.
2. **BTM girişimci açma:** BTM Admin → Girişimci Ekle → org oluştur + sahibi davet et → plan/limit ata → durum izle.
3. **Unsubscribe:** her kampanya e-postası footer linki + one-click header; sayfa tek tıkla onaylar, org'a bağlı suppression yazar.

## Ekran envanteri (V1)

Dashboard · Campaigns (liste, oluştur sihirbazı: ad→gönderici→konu/önizleme→audience→içerik→takip/UTM→test→zamanla→gönder, detay/analitik) · Templates (galeri, editör, sürümler) · Audience (Contacts, Lists, Segments, Tags, Suppression, Import) · Analytics · Deliverability · Brand Kit · Settings (Organization, Members, Sender/Domains, Billing/Usage, Audit log) · BTM Admin (Entrepreneurs) · Platform Admin. Her ekranda: boş/yükleniyor/hata durumu, klavye erişimi, mobil durumu, yıkıcı eylem onayı (brief §62–63).

## Tasarım dili

`MAILORY_DECISIONS.md` D-004. Token tabanlı (oklch), light/dark, 8px ölçek, 6–10px radius, tek ikon seti (lucide), Radix tabanlı bileşenler, WCAG 2.2 AA, tablo-öncelikli (server-side sayfalama/filtre), AI yüzeyleri küçük bağlamsal paneller (özet→kanıt→aksiyon), sohbet balonu/emoji yok.

## Gizlilik / KVKK tasarım ilkeleri

Contact başına `consent_status`, `consent_source`, `consent_at`, `unsubscribed_at`; org başına suppression; contact silme ve dışa aktarma; import sırasında "izin beyanı" zorunlu onayı; gizlilik/şart sayfaları için yer tutucu rotalar. Hukuki uygunluk harici uzman değerlendirmesine tabidir.

## Başarı ölçütleri

Milestone 1: BTM bir kampanyayı SES üzerinden gönderir, bounce/complaint/unsubscribe doğru işlenir. Aktivasyon: kayıttan ilk gönderime medyan süre. Teslim: delivery rate ≥ %98, bounce < %2, complaint < %0.1.
