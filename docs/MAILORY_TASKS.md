# Mailory — Tasks

Durum: `todo` · `doing` · `done` · `blocked`. Öncelik: P0 (V1 çekirdeği) · P1 · P2.

| ID       | Title                                         | Pri | Phase | Deps    | Description                                                                                                                                                                    | Acceptance Criteria                             | Status  |
| -------- | --------------------------------------------- | --- | ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------- |
| MAIL-001 | Project audit                                 | P0  | 0     | —       | Repo, CiM, tasarım ve Railway çıkarım audit'i                                                                                                                                  | `MAILORY_DISCOVERY.md` mevcut                   | done    |
| MAIL-002 | Database architecture                         | P0  | 0     | 001     | Normalize veri modeli                                                                                                                                                          | `MAILORY_DATABASE.md`                           | done    |
| MAIL-003 | Product/arch/roadmap/decisions docs           | P0  | 0     | 001     | Yedi teslim dosyası                                                                                                                                                            | Dosyalar repoda                                 | done    |
| MAIL-010 | Monorepo foundation                           | P0  | 1     | 003     | pnpm workspace, tsconfig, eslint, prettier, vitest, CI                                                                                                                         | `pnpm lint typecheck test build` yeşil          | done    |
| MAIL-011 | Config package                                | P0  | 1     | 010     | Zod env doğrulama                                                                                                                                                              | Eksik env boot'ta hata verir; test              | done    |
| MAIL-012 | UI package (tokens + core bileşenler)         | P0  | 1     | 010     | Button, Input, Field, Badge, Dialog, Sheet, Select, Tooltip, Skeleton, EmptyState, Table                                                                                       | Bileşen testleri, light/dark                    | done    |
| MAIL-013 | App shell + nav + `/api/health`               | P0  | 1     | 012     | Sidebar/topbar/mobil nav, health uçları                                                                                                                                        | Health 200; e2e duman                           | done    |
| MAIL-014 | DB package + migration runner                 | P0  | 1     | 011     | Drizzle bağlantı, migrate scripti, test DB yardımcıları                                                                                                                        | Migrate temiz DB'de çalışır                     | done    |
| MAIL-020 | Identity schema                               | P0  | 2     | 014     | users/sessions/tokens                                                                                                                                                          | Migration + test                                | done    |
| MAIL-021 | Signup/login/logout + oturum                  | P0  | 2     | 020     | Argon2id, cookie, rate limit, CSRF                                                                                                                                             | Auth integration testleri                       | done    |
| MAIL-022 | E-posta doğrulama + parola sıfırlama          | P1  | 2     | 021     | Token akışı, EmailTransport(console)                                                                                                                                           | Testler                                         | done    |
| MAIL-030 | Organization + membership                     | P0  | 3     | 021     | Org oluşturma, aktif org, üyelik                                                                                                                                               | Kayıtta org oluşur                              | done    |
| MAIL-031 | RBAC                                          | P0  | 3     | 030     | Rol→izin tablosu, `can()`, route guard                                                                                                                                         | Yetki testleri                                  | done    |
| MAIL-032 | Invitations                                   | P1  | 3     | 031     | Davet/kabul                                                                                                                                                                    | Testler                                         | done    |
| MAIL-033 | Audit log                                     | P0  | 3     | 030     | Append-only log servisi                                                                                                                                                        | Kritik eylemler loglanır                        | done    |
| MAIL-034 | Tenant isolation test harness                 | P0  | 3     | 030     | A→B negatif test yardımcısı                                                                                                                                                    | Her yeni uç için şablon                         | done    |
| MAIL-040 | Contacts CRUD + listeler + tag + custom field | P0  | 4     | 034     | Server-side sayfalama/filtre                                                                                                                                                   | 10K'da hızlı; izolasyon testi                   | done    |
| MAIL-041 | CSV import/export                             | P0  | 4     | 040     | Eşleme, doğrulama, consent beyanı, export kaçışı                                                                                                                               | Import testleri                                 | done    |
| MAIL-042 | Suppression + consent alanları                | P0  | 4     | 040     | Org suppression, unsubscribe durumu                                                                                                                                            | Testler                                         | done    |
| MAIL-043 | Segment motoru                                | P0  | 4     | 040     | AST→SQL, builder UI                                                                                                                                                            | AST testleri, SQL enjeksiyon testi              | done    |
| MAIL-044 | Engagement score                              | P1  | 4     | 090     | Nightly job, bantlar                                                                                                                                                           | Hesap testi                                     | done    |
| MAIL-050 | Block modeli + HTML/text render               | P0  | 5     | 012     | JSON blokları → e-posta HTML                                                                                                                                                   | Render snapshot testleri                        | done    |
| MAIL-051 | Editör UI                                     | P0  | 5     | 050     | Sürükle-bırak bloklar, dinamik alanlar                                                                                                                                         | e2e, klavye erişimi                             | done    |
| MAIL-052 | Template yönetimi + library                   | P0  | 5     | 050     | Kaydet/çoğalt/sürüm/arşiv                                                                                                                                                      | Testler                                         | done    |
| MAIL-053 | Brand Kit                                     | P1  | 5     | 052     | Logo/renk/font/footer                                                                                                                                                          | Yeni mail marka ile açılır                      | done    |
| MAIL-060 | Sender identity + domain doğrulama            | P0  | 6     | 034     | DNS kayıt üretimi, kontrol job'ı                                                                                                                                               | Pending→Verified akışı                          | done    |
| MAIL-061 | Onboarding                                    | P1  | 6     | 053,060 | 7 adım ilerleme                                                                                                                                                                | e2e                                             | done    |
| MAIL-070 | Campaign model + durum makinesi               | P0  | 7     | 052,060 | Draft→…→Completed                                                                                                                                                              | Geçiş testleri                                  | done    |
| MAIL-071 | Campaign sihirbazı + UTM + test gönderimi     | P0  | 7     | 070     | 13 adım                                                                                                                                                                        | e2e                                             | done    |
| MAIL-072 | Planlama + approval workflow                  | P1  | 7     | 070     | Zamanlama, onay                                                                                                                                                                | Testler                                         | done    |
| MAIL-080 | EmailTransport (console + SES)                | P0  | 8     | 014     | SES SDK v3, MIME, header'lar                                                                                                                                                   | Transport sözleşme testleri                     | done    |
| MAIL-081 | Send kuyruğu + worker + retry                 | P0  | 8     | 070,080 | Recipient materialize, batch, backoff                                                                                                                                          | Kuyruk entegrasyon testleri                     | done    |
| MAIL-082 | SES/SNS webhook                               | P0  | 8     | 081     | İmza doğrulama, idempotency, bounce/complaint                                                                                                                                  | Fixture testleri                                | done    |
| MAIL-083 | Unsubscribe (sayfa + one-click)               | P0  | 8     | 042,081 | İmzalı token, RFC 8058                                                                                                                                                         | Testler                                         | done    |
| MAIL-084 | Abuse korumaları                              | P0  | 8     | 081     | Rate/limit/otomatik duraklatma                                                                                                                                                 | Testler                                         | done    |
| MAIL-090 | Open/click tracking                           | P0  | 9     | 081     | Pixel, link yönlendirme, bot filtresi                                                                                                                                          | Testler                                         | done    |
| MAIL-091 | Analitik + dashboard                          | P0  | 9     | 090     | KPI'lar, kampanya karşılaştırma, link analitiği                                                                                                                                | Testler                                         | done    |
| MAIL-092 | Rapor dışa aktarma                            | P2  | 9     | 091     | CSV/PDF                                                                                                                                                                        | Testler                                         | done    |
| MAIL-100 | Deliverability Center + Campaign Health       | P1  | 10    | 060,091 | Skor + aksiyon listesi, kural tabanlı                                                                                                                                          | Testler                                         | done    |
| MAIL-110 | Automation engine                             | P2  | 11    | 081     | Trigger→Condition→Delay→Email→Branch                                                                                                                                           |                                                 | done    |
| MAIL-120 | AI Copilot / Review / Analyst                 | P2  | 12    | 100     | Sağlayıcı soyutlaması                                                                                                                                                          | Onaysız gönderim yok testi                      | done    |
| MAIL-130 | Partner org + sponsorships + BTM Admin        | P0  | 13    | 030,140 | Girişimci org aç, limit ata                                                                                                                                                    | İçerik erişimi olmadığını doğrulayan test       | done    |
| MAIL-131 | Platform Admin                                | P1  | 13    | 030     | Org/kullanım/kuyruk/SES görünümü                                                                                                                                               |                                                 | done    |
| MAIL-132 | BTM Template Hub                              | P2  | 13    | 052,130 | Partner şablon paylaşımı                                                                                                                                                       |                                                 | done    |
| MAIL-140 | Entitlements + usage                          | P0  | 14    | 030     | `checkEntitlement`, sayaçlar                                                                                                                                                   | Limit testleri                                  | done    |
| MAIL-150 | Güvenlik sertleştirme + RLS                   | P0  | 15    | tümü    | RLS, CSP, yük testi                                                                                                                                                            |                                                 | done    |
| MAIL-151 | KVKK: veri dışa aktarma/silme                 | P1  | 15    | 040     |                                                                                                                                                                                |                                                 | done    |
| MAIL-160 | Railway deploy (insan adımı gerekir)          | P0  | 16    | 150     | Dockerfile'lar, runbook                                                                                                                                                        | Staging health yeşil                            | blocked |
| MAIL-170 | BTM pilot                                     | P0  | 17    | 160     |                                                                                                                                                                                |                                                 | todo    |
| MAIL-180 | Public launch                                 | P1  | 18    | 170     | Fiyat analizi, public API                                                                                                                                                      |                                                 | todo    |
| MAIL-190 | Browser e2e in CI                             | P1  | 4     | 013     | `e2e/audience`, `templates` ve `senders` e2e betikleri yerelde çalışıyor (senders `next dev` + `DNS_RESOLVER=mock` ister); CI'da tarayıcı kurulumu + sunucu başlatma eklenecek | CI'da e2e job yeşil                             | todo    |
| MAIL-191 | Worker-based CSV import                       | P2  | 4     | 081     | >50k satır veya çok büyük dosyalar için kuyruklu import + ilerleme                                                                                                             | 500k satır import edilir, UI ilerleme gösterir  | todo    |
| MAIL-192 | Trigram search index                          | P2  | 4     | 040     | 100k+ contact'ta alt dize arama için `pg_trgm` GIN                                                                                                                             | 250k'da arama < 200 ms (ölçülü)                 | todo    |
| MAIL-193 | Contact limit entitlement                     | P0  | 14    | 140     | Import/create sırasında `contacts` entitlement kontrolü (şimdilik sınırsız)                                                                                                    | Limit aşımı reddedilir                          | done    |
| MAIL-194 | Move assets to object storage                 | P2  | 5     | 053     | `assets` baytlarını R2/S3'e taşı; `/a/<id>` URL sözleşmesi değişmez                                                                                                            | Mevcut şablonlar kırılmadan taşınır             | todo    |
| MAIL-195 | Real email-client rendering pass              | P0  | 5     | 050     | Outlook (masaüstü), Gmail, Apple Mail, mobil istemcilerde kütüphane şablonlarını test et (Litmus/Email on Acid); Outlook için VML buton değerlendir                            | Her kütüphane şablonu hedef istemcilerde okunur | todo    |
| MAIL-196 | Dark-mode email styles                        | P2  | 5     | 050     | `prefers-color-scheme` desteği                                                                                                                                                 | Koyu modda okunabilir                           | todo    |
| MAIL-197 | Drag-and-drop inside columns                  | P2  | 5     | 051     | Sütun içi blokları da sürükle-bırak ile taşı                                                                                                                                   | Sütunlar arası sürükleme                        | todo    |
| MAIL-198 | Social icon images                            | P2  | 5     | 053     | Sosyal bağlantılar şimdilik metin; ikon görselleri (barındırılan)                                                                                                              | İstemcilerde ikonlar görünür                    | todo    |

## Faz 6 devam işleri

- Faz 8: gerçek SES `DomainProvider` (CreateEmailIdentity/DKIM durumu, sandbox çıkışı) — şu an stub.
- DMARC alt alan adı mirası (üst alan DMARC'ı) henüz hesaba katılmıyor.
- Doğrulama başarısızlığı/başarısı için kullanıcıya e-posta bildirimi (Faz 8 outbox ile).
- Alan adı kaldırıldığında bağlı gönderici kimliklerinin kullanım dışı kalması kampanya doğrulamasında (Faz 7) engellenecek.

## Faz 7 devam işleri

- Faz 8: zamanlanmış kampanyaları alıp alıcıları (`countSendable` koşuluyla) oluşturan ve SES ile gönderen motor; `scheduled → sending` geçişi ve `campaigns_due_idx` taraması orada.
- Faz 8: test e-postasının HTML gövdesi gerçek taşıyıcıyla gitsin (şu an outbox'ta metin).
- Çok adımlı sihirbaz yerine tek sayfa bölümlü düzenleyici yapıldı; adım adım rehber ve kitle birleşimi (liste ∪ segment, hariç tutma) V2.
- Kampanya içi A/B testi (`ab_test`) ve gönderim saati optimizasyonu: V2.
- Onay bildirimi (e-posta) Faz 8 outbox ile; şimdilik onaylayıcı listeden görür.
- E2E: `e2e/campaigns.e2e.cjs` yerelde `next dev` ile koşar; CI işi MAIL-190 kapsamında.

## Faz 8 devam işleri

- **Üretime almadan önce (insan işi):** SES hesabı sandbox çıkışı, yapılandırma seti + SNS topic + HTTPS aboneliği (`/api/webhooks/ses`), `AWS_*` değişkenleri; `DOMAIN_PROVIDER=ses` hâlâ stub (gerçek `CreateEmailIdentity`/DKIM durumu okuması yok — alan adı doğrulaması DNS'ten türetiliyor). Gerçek SES'e karşı canlı duman testi yapılmadı.
- "Tarayıcıda görüntüle" bağlantısı şimdilik uygulama köküne gider (sayfa Faz 9'da).
- Açılma/tıklama izleme ve `link_clicks` Faz 9; SES `Open/Click` olayları şimdilik yalnızca saklanıyor.
- Dağıtık hız sınırlayıcı (çoklu worker toplamı) ve platform yöneticisinin `daily_send_limit` yükseltme ekranı (Faz 15).
- At-least-once penceresi (D-059) için SES `Tags` ile mutabakat işi (olay gelip DB'de bulunmayan mesajlar).
- Kısmi gönderim sonrası "devam ettir" kullanıcıya açık; otomatik duraklatma sonrası listeyi temizleme rehberi (UI metni var, sihirbaz yok).
- E2E: `e2e/sending.e2e.cjs` gerçek worker'ı başlatır; CI işi MAIL-190.

## Faz 9 devam işleri

- PDF rapor dışa aktarma (MAIL-092'nin yalnızca CSV kısmı yapıldı); kampanya bazlı CSV (alıcı düzeyinde etkileşim) ve zamanlanmış e-posta raporu.
- `campaign_stats` artımlı toplama: büyük kampanyalarda (>1M alıcı) okuma-anı sorguları yavaşlarsa (ölçüm Faz 15 yük testinde).
- Cihaz/ülke/e-posta istemcisi kırılımı (şimdilik yalnızca cihaz sınıfı saklanıyor, ülke yok — IP'den türetmek ham IP gerektirir).
- Segment/etiket bazlı karşılaştırma, dönem seçici (şimdi sabit 30 gün) ve kampanya karşılaştırma grafiği.
- Takip edilen bağlantılar için ters vekil/özel izleme alan adı (özel alan adıyla `/c/` ve `/o/`) — teslim edilebilirlik için Faz 14.
- SES `Open`/`Click` olayları kullanılmıyor (kendi izlememiz asıl); ikisi arasında mutabakat işi yok.
- Eski kampanyaların `tracking_events` temizliği/saklama süresi politikası (KVKK saklama) Faz 15.

## Faz 10 devam işleri

- Harici itibar verisi (Google Postmaster Tools, Microsoft SNDS) entegrasyonu — hesap bağlama gerektirir; şimdilik yalnızca kendi verimiz.
- Gönderim öncesi **seed-list/inbox testi** (GlockApps vb.) ve gerçek spam skoru (SpamAssassin) — dış hizmet.
- Uyarı e-postası/bildirimi (Deliverability aksiyonları için) — bildirim altyapısı Faz 13/14 ile.
- Kural kümesinin dil/sektör bazlı ayarlanması; kullanıcı geri bildirimiyle kalibrasyon.

## Faz 11 devam işleri

- Görsel tuval (sürükle-bırak akış çizimi) ve dalların yeniden birleşmesi; şimdilik liste tabanlı oluşturucu, terminal dallar.
- Ek tetikleyiciler: form gönderimi, tarih alanı (doğum günü), e-posta etkileşimi (açtı/tıkladı), API olayı (Faz 18 public API ile).
- Ek eylemler: etiket ekle/çıkar, listeye ekle, başka otomasyona geçir, bildirim; A/B dalı.
- Akış yeniden girişi (re-entry) ve "hedef" (goal) çıkışları; şimdilik kişi başına bir kez.
- Otomasyon içi e-postalar için günlük sınır/ısınma etkileşimi ayrı izlenmiyor (kampanya sınırıyla ortak).
- Tetikleme gecikmesi: işçi 30 sn'de bir tarar; yüksek hacimde olay tabanlı (outbox) tetikleme düşünülebilir.

## Faz 12 devam işleri

- Gerçek Anthropic anahtarıyla canlı duman testi yapılmadı (yalnızca enjekte fetch ile sözleşme testi); anahtar eklenince bir kez denenmeli (A8).
- Çıktı kalitesi/istem ayarı gerçek veriyle; Türkçe pazarlama tonu değerlendirmesi; kullanıcı geri bildirim düğmesi (beğendim/beğenmedim).
- Gönderim zamanı önerisi (Smart Send), Akıllı yeniden gönderim (Smart Resend), A/B konu testi — V1.1 (AI önerisi + onaylı A/B).
- AI kullanım maliyeti/token raporu (token sayıları kaydediliyor, arayüz yok); plan bazlı kota Faz 14 entitlement ile.
- Akış (otomasyon) ve segment için AI yardımı; görsel üretimi yok (bilinçli).

## Faz 14 devam işleri

- **Ödeme sağlayıcısı (Stripe/iyzico) yok:** `subscriptions.source='stripe'` ve `billing_*` alanları yer tutucu; planı şimdilik platform/partner yöneticisi atar. Fiyat/plan sınırları hipotezdir (A9) — gerçek maliyet ve rakip verisiyle Faz 18 fiyat analizinde kalibre edilecek.
- Sınıra yaklaşınca (%80) kullanıcıya e-posta/uygulama içi uyarı; yükseltme talebi akışı.
- `api_requests` ölçümü (Faz 18 public API ile), segment/otomasyon sayısı gibi ek anahtarlar.
- Dönem ortası plan değişiminde orantılama yok (aylık sınır yeni plana göre anında uygulanır).

## Faz 13 devam işleri

- **Destek erişimi (impersonation) yok:** platform yöneticisi bir kullanıcının ekranını görüp yardım edemez; gerekirse süreli, kullanıcı onaylı, tam denetimli 'destek oturumu' tasarlanmalı (A10 kararı).
- Partner için sponsorluk **bütçesi** (toplam kişi/e-posta havuzu) ve raporlama (aylık kullanım raporu CSV/PDF) — brief: 'BTM sponsorlu plan maliyeti BTM'ye kullanım raporu ile gösterilir'.
- Şablon Merkezi: çocuk markasına otomatik uyarlama, sürümleme/güncelleme bildirimi, kategori/arama.
- Girişimci davetinin süresi dolarsa yeniden gönderme düğmesi (şimdi partner yeni çocuk açmadan yeniden davet edemez — `inviteFirstOwner` servis olarak var, arayüzü yok).
- Çoklu partner ve iç içe hiyerarşi (partnerin partneri) desteklenmiyor (bilinçli: tek kademe).
- Platform: işçi/SES/kuyruk için ayrıntılı görünüm (BullMQ kuyruk derinlikleri, SES hesap kotası) ve uyarılar (Faz 16 gözlemlenebilirlik).
