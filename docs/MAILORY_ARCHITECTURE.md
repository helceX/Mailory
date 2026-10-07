# Mailory — Architecture

## 1. Topoloji (Railway, ayrı project)

```
 Browser ─► web (Next.js, stateless) ─► Postgres (primary)
                │                          ▲
                ├─► Redis (BullMQ, rate limit, cache)
                │        │
                │        ▼
                │     worker (BullMQ) ─► Amazon SES ─► SNS ─► web:/api/webhooks/ses
                └─► Object storage (S3/R2: logo, import dosyaları, export)
```

- **Faz 1 (sade):** `web`, `worker`, Postgres, Redis = 4 servis. `web` içinde zamanlayıcı yok; zamanlama worker'da _repeatable job_.
- Migration: web deploy öncesi `pnpm db:migrate` (release command). Forward-only, additive-first.
- Health: `GET /api/health` (liveness) ve `GET /api/health/ready` (DB + Redis). Worker: HTTP'siz, Redis heartbeat anahtarı → platform admin panelinde görünür.
- Sır yönetimi: yalnızca Railway Variables; Zod ile boot'ta doğrulama; DKIM/SES sırları loglanmaz; org'a ait üçüncü taraf sırları (ileride) AES-256-GCM ile şifreli saklanır (`APP_ENCRYPTION_KEY`).

## 2. Monorepo

```
apps/web        Next.js (UI + API route handlers, server actions yalnızca UI içi)
apps/worker     BullMQ işçileri: send, schedule, ses-events, import, scores, domain-check
packages/config Zod env
packages/db     Drizzle şema, migration, repository (tenant-scoped), seed
packages/core   Domain saf mantığı: authz, entitlements, segment AST, engagement, campaign state machine, email render
packages/ui     Design system (tokens + Radix)
packages/validation  Paylaşılan Zod şemaları
packages/email  EmailTransport (console/ses), şablon render, MIME, tracking URL imzaları
packages/ai     Sağlayıcı soyutlaması (V2)
```

Kural: `core` ve `email` saf (IO'suz) → birim test; IO `db` ve uygulamalardadır.

## 3. Tenancy ve yetkilendirme

- Her tenant tablosunda `organization_id NOT NULL`, ilk sütun bileşik indekslerde.
- `db` repository fonksiyonları `(db, organizationId: OrganizationId, …)` imzası zorunlu; org id yalnızca oturum üyeliğinden çözülür (`getOrgContext`), istemci girdisi doğrulanır.
- Aktif org seçimi: kullanıcı birden çok org üyesi olabilir (BTM yöneticisi + kendi girişimci org'u); aktif org cookie'de tutulur ama **her istekte üyelik tablosuna karşı doğrulanır**.
- Platform Admin: `users.is_platform_admin`; org içeriğine erişim yok, yalnızca idari görünümler; "support access" ayrı audit'li eylem (V2).
- Partner: `organizations.parent_organization_id`; partner izinleri yalnızca `sponsorships`/kullanım/onboarding görünümleriyle sınırlı (D-007). İçerik tablolarına parent join'i **yoktur** — mimari düzeyde engel.
- İkinci katman: Postgres RLS (Faz 15) — `SET LOCAL app.org_id` işlem başına, tenant tablolarında `USING (organization_id = current_setting('app.org_id')::uuid)`.
- Test zorunluluğu: her liste/detay/mutasyon için A→B negatif test.

## 4. Gönderim hattı

```
Campaign(scheduled) ──(worker: schedule tick)──► materialize recipients
   │ audience = liste ∪ segment → suppression/consent/unsub filtrele → entitlement kontrol
   ▼
campaign_recipients(status=queued) ──► BullMQ "send" (batch 50, org başına limiter)
   ▼ worker
render (kişiselleştirme + link yeniden yazma + pixel + List-Unsubscribe) ─► SES SendEmail
   ▼ ok → status=sent, ses_message_id          ▼ throttling/5xx → retry (backoff, ≤5)
                                                ▼ kalıcı (4xx, MessageRejected) → failed
SES → SNS → /api/webhooks/ses → email_events (idempotent) → recipient.status (delivered/bounced/complained), suppression, org sağlık sayaçları
```

- Durum makinesi: `queued → processing → sent → delivered | bounced | complained | rejected | failed` (yalnızca ileri geçişler; geç gelen olay daha ileri durumu geriye almaz).
- İdempotency: `UNIQUE(campaign_id, contact_id)`; worker işi `recipient_id` ile `jobId`; SES event `UNIQUE(provider_event_id)`; `ON CONFLICT DO NOTHING`.
- Kampanya durumu: `draft → review → scheduled → sending → sent → completed`; `review` yalnızca approval politikası açıksa; `sending` sırasında iptal = `canceled` (kalan queued → `canceled`).
- Abuse: org başına günlük/aylık limit (entitlement), saatlik hız sınırı, yeni org için "ısınma" tavanı, bounce > %5 veya complaint > %0.3 → org gönderimi otomatik duraklatılır + platform admin uyarısı. Test gönderimi: org başına dakikada 5, en çok 10 alıcı.
- Gönderen kimliği: doğrulanmamış domain ile kampanya gönderimi **reddedilir**.

## 5. Tracking

- Pixel: `/t/o/{token}.gif`; link: `/t/c/{token}` → 302. `token` = HMAC imzalı `(recipient_id, link_id)`; açık yönlendirme yok (hedef URL DB'den, imzalı token'dan değil).
- Bot/Apple MPP filtresi: user-agent + saniyeler içinde çoklu açılma; açılma "tahmini" etiketi.
- UTM: gönderim anında link yeniden yazımında uygulanır.

## 6. Domain doğrulama

SES `CreateEmailIdentity` (Easy DKIM, 3 CNAME) + SPF TXT + DMARC TXT önerisi üretilir; `domain-check` job'ı DNS'i (DoH/`dns.resolve`) yoklar, SES `GetEmailIdentity` doğrulama durumunu okur. DNS kayıtları kullanıcı dostu açıklamalarla sunulur.

## 7. API katmanı

Route handler'lar ince: `auth → authz → validate (Zod) → service (core/db) → audit`. İş mantığı `core`/`db`'de olduğundan V2'de `/api/v1/*` (API key + scope) aynı servisleri çağırır. Hata biçimi: `{error:{code,message,requestId}}`.

## 8. Güvenlik kontrol listesi

Argon2id, oturum cookie `__Host-` + httpOnly + SameSite=Lax + Secure, Origin/Referer CSRF kontrolü (CiM deseni), Redis rate limit (login, signup, import, test-send, unsubscribe), Zod giriş doğrulama, parametreli SQL (segment AST beyaz liste), HTML sanitizasyonu (HTML bloğu için allow-list; scriptler atılır), dosya yüklemede MIME + boyut + uzantı sınırı, CSV formül enjeksiyonu kaçışı (export), SNS imza doğrulaması (sertifika URL'i `sns.*.amazonaws.com` doğrulanır), audit log, CSP başlıkları, secret taraması CI'da.

## 9. Gözlemlenebilirlik

Yapılandırılmış JSON log (`request_id`, `organization_id`, `user_id`, `job_id`), Sentry (DSN opsiyonel), kuyruk derinliği/başarısızlık sayaçları platform admin panelinde, SES hesap durumu (bounce/complaint oranları) periyodik çekilir.

## 10. Performans

Keyset sayfalama, `(organization_id, …)` bileşik indeksleri, `lower(email)` unique indeksi, import `COPY`/toplu `INSERT … ON CONFLICT`, event tablosu aylık partisyon adayı (100K+ ölçeği için), analitik önbelleği `campaign_stats` toplama tablosu (olaylarla artımlı güncellenir).

## 11. Ölçülen performans (Faz 4)

Yerel PostgreSQL 16, **25.000 contact**, tek org (`PERF=1 pnpm exec vitest run apps/web/src/lib/audience/perf`):

| İşlem                                    | Süre   |
| ---------------------------------------- | ------ |
| İlk sayfa (50 satır) + toplam sayı       | 20 ms  |
| 101. sayfa (keyset, sayısız)             | 3 ms   |
| Alt dize arama (ad/e-posta/şirket)       | 29 ms  |
| Durum filtresi                           | 4 ms   |
| Segment önizleme (VE/VEYA, sayı + örnek) | 14 ms  |
| 10.000 satır CSV import                  | 1,5 sn |
| 5.000 mevcut kişiyi upsert               | 0,6 sn |

Sınırlar (dürüstçe): ölçüm 25k'da; 100k+/1M'de **ölçülmedi**. Alt dize arama `ILIKE '%…%'` kullanır (org içinde tarama, trigram indeksi yok); 100k+ için `pg_trgm` GIN indeksi gerekir (MAIL-192). Toplam sayı `count(*)`'tır; çok büyük org'larda önbelleğe alınmalı.

## 12. E-posta üretim hattı ve güvenlik (Faz 5)

```
EmailDoc (JSON bloklar) ──► doğrulama (zod, allow-list) ──► kaydet (immutable sürüm)
        │
        └─► renderEmail(doc, {kişi değerleri, appUrl, marka logosu})
              • metin: escape → markdown-lite → birleştirme({{alan|yedek}})
              • HTML bloğu: sanitize-html allow-list → birleştirme
              • bağlantı: allow-list + encodeURIComponent; geçersiz → "#"
              ▼
         { html (tablo+inline CSS, @media 620px), text, unknownKeys, warnings }
```

- Gönderimde (Faz 8) aynı `renderEmail` kişi başına çağrılır; bağlantı yeniden yazımı (izleme/UTM) render çıktısı üzerinde yapılır.
- Önizleme uç noktası gönderilecek HTML'i üretir; `sandbox` iframe + `CSP: sandbox` ile gösterilir.
- **Doğrulanmadı:** gerçek e-posta istemcilerinde (Outlook masaüstü, Gmail, Apple Mail) görünüm. Yapısal kurallara (tablo, inline CSS, betik/harici CSS yok, mobil `@media`) uyuluyor ama istemci testi (Litmus/Email on Acid) BTM pilotundan önce yapılmalı (MAIL-195).

## 13. Alan adı doğrulama ve worker (Faz 6)

- `@mailory/email`: DNS kayıt üretimi/kontrolü (`dns.ts`), sağlayıcı soyutlaması (`provider.ts`), durum makinesi (`domain-verify.ts`).
- `@mailory/deliverability`: çözümleyici/sağlayıcı fabrikaları + `checkAndPersistDomain` + `sweepDomains` (web ve worker ortak kullanır).
- `apps/worker`: BullMQ `domain-check` kuyruğu, 5 dk'lık job scheduler; tek eşzamanlı süpürme. Entegrasyon testi gerçek Postgres+Redis ile koşar.
- Onboarding: `getOnboarding` 7 adım (organizasyon, logo, marka, gönderici, alan adı, kişiler, şablon); panoda bitene kadar gösterilir.

## 14. Kampanya motoru (Faz 7)

- `@mailory/core/campaign`: durum makinesi, hazırlık denetimi, UTM yardımcıları (saf, tarayıcı güvenli). `@mailory/email/utm`: render çıktısına UTM.
- `apps/web/src/lib/campaigns/service.ts`: RBAC + tenant izolasyonu + denetim kaydı; tüm durum değişiklikleri `transitionCampaign` (CAS). API: `/api/campaigns[/id[/preview|test|schedule|submit|approve|reject|withdraw|cancel|duplicate]]`, `/api/campaign-policy`.
- Arayüz: `/campaigns` (durum sekmeleri, onay politikası), `/campaigns/[id]` (taslakta bölümlü düzenleyici + hazırlık paneli; diğer durumlarda durum paneli).
- Faz 8 sınırı: bu faz hiçbir şey **göndermez**; `scheduled` kampanyalarını Faz 8 motoru alır.

## 15. Gönderim motoru (Faz 8)

- `@mailory/sending`: `dispatchDue` (scheduled→sending CAS + alıcı dondurma), `sendBatch` (claim → yeniden kontrol → render → UTM → taşıyıcı → durum), `resumeDailyLimited`, `evaluateHealth`, `tick`; `unsubscribe.ts`; `ses-events.ts`.
- `@mailory/email`: `transport.ts` (Console/SES, başlık güvenliği, hata sınıflama), `sns.ts` (imza doğrulama).
- `apps/worker`: `campaign-send` kuyruğu (15 sn scheduler, concurrency 1) + `domain-check`.
- Web: `/api/webhooks/ses`, `/unsubscribe/[token]` (+ `/api/unsubscribe/[token]`), kampanya duraklat/devam/ilerleme.
- Akış: onay → `scheduled` → tick → `sending` (+alıcılar) → partiler → `completed` | `paused` (neden `halt_reason`) ; SES olayları → alıcı durumu/bastırma → sağlık kontrolü.

## 16. İzleme ve analitik (Faz 9)

- `@mailory/sending/message.ts` `renderMessage`: alıcı e-postasının tek üretim noktası (birleştirme → render → UTM → bağlantı yeniden yazma → piksel). Motor ve `/view` aynı fonksiyonu kullanır.
- Uç noktalar: `/o/<token>.gif`, `/c/<token>`, `/view/<token>` (hepsi oturumsuz, imzalı token; çerez yok). Tokenlar `signed-token.ts`'de amaca bağlı (`open|click|view|unsubscribe`).
- `@mailory/db` `tracking.ts`: bağlantı kaydı, olay kaydı (alıcı org/kampanya eşleşmesi doğrulanarak), `campaignStats`, `topLinks`, `engagementTimeline`, `compareCampaigns`, `orgOverview`.
- Web: `lib/analytics/service.ts` (RBAC `analytics:read`, tenant izolasyonu), `/analytics`, kampanya sayfasında Performans bölümü, dashboard KPI'ları, `/api/analytics/export` (CSV).

## 17. Teslim edilebilirlik (Faz 10)

- `@mailory/core/deliverability.ts` (saf kurallar + skor + etkileşim formülü); web `lib/deliverability/service.ts` (Merkez), kampanya servisinde `health` (düzenleyicide İçerik sağlığı paneli), analitik raporunda sonuç tabanlı bulgular.
- `@mailory/db` `deliverability.ts`: `refreshEngagement` (gece işi), `audienceEngagement`, `listHealth`. Worker: `engagement-refresh` (cron `0 3 * * *` UTC).

## 18. Otomasyon (Faz 11)

- `@mailory/sending/automation.ts`: `enrollTriggers`, `runEnrollment` (e-posta→alıcı satırı kuyruğa; bekle→`next_run_at`; koşul→dal), `processEnrollments` (lease'li talep), `automationTick`. Worker `automation-tick` (30 sn) + mevcut `campaign-send` tick'i e-postaları yollar.
- Web: `lib/automations/service.ts` (RBAC, tenant doğrulaması, etkinleştirme dondurma), `/automations`, `/automations/[id]` (oluşturucu + durum paneli), `/api/automations/*`.

## 19. Yapay zekâ yardımcısı (Faz 12)

- `@mailory/ai`: sağlayıcılar (Anthropic/mock), istem üreticileri + çıktı ayrıştırıcıları (`features.ts`). Web `lib/ai/service.ts`: konu önerisi, içerik incelemesi (kural bulgularına ek), analist (yalnızca toplamlar), taslak yazımı; kapı: sağlayıcı var → org opt-in → günlük sınır. API `/api/ai/*`, `/api/campaigns/[id]/ai/*`.
- Arayüz: kampanya düzenleyicide yardımcı paneli, raporda 'Sonuçları yorumla', şablonlarda 'Yapay zekâ ile taslak', Kampanyalar sayfasında açma anahtarı.
