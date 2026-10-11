# Mailory — Discovery Report (Phase 0)

Tarih: 2026-10-07 · Kapsam: salt-okunur audit. Hiçbir mevcut sistem değiştirilmedi.

## 1. Mevcut durum

| Kaynak                                                          | Durum                                                                                                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `helceX/Mailory`                                                | Boş (yalnızca `README.md`, 1 commit). Greenfield. Geliştirme dalı: `claude/mailory-saas-platform-hkk3r7`.                                                              |
| `helceX/CiM` (Mediaory — "Communication Intelligence Platform") | Erişildi (read-only klon). 828 dosya, pnpm monorepo, production'da çalışan çok kiracılı SaaS.                                                                          |
| `helceX/HRghost`, `helceX/brand-kit`                            | Listede var; bu audit kapsamında incelenmedi. `brand-kit` (fork) Brand Kit modülü için ileride bakılabilir.                                                            |
| Railway                                                         | **Doğrudan denetlenemedi**: bu oturumda Railway CLI/token/MCP yok. Bulgular CiM repo'sundaki referanslardan çıkarıldı (bkz. §4). Mevcut Railway projesine dokunulmadı. |
| Yerel ortam                                                     | Node 22.22, pnpm 10.28, PostgreSQL 16 (kurulu, kapalı), Redis 7, Docker CLI var. Entegrasyon testleri yerelde çalıştırılabilir.                                        |

> "Media Takip Merkezi" ifadesi CiM kodunda birebir geçmiyor. CiM'in giriş yapılmış paneli (`.mp` kabuğu: `apps/web/src/app/panel.css`, `(app)/layout.tsx`, `app-sidebar.tsx`, `kpi-row.tsx`) medya takip ürünü olduğundan tasarım referansı olarak bu panel alındı. (Varsayım — DECISIONS D-004.)

## 2. CiM teknik standardı (Mailory bunu devralır)

- **Monorepo:** pnpm workspace, `apps/web` (Next.js 16.3, React 19.3, Tailwind 4 CSS-first), `apps/worker` (BullMQ 6, tsx ile çalışır), `packages/{ui,db,core,config,validation,ai,reports,search,ingestion}`.
- **DB:** PostgreSQL + Drizzle ORM 0.45 + drizzle-kit migrations (forward-only, additive-first). Yerel PG 17 (pgvector) — Mailory'de pgvector gerekmez.
- **Auth:** e-posta+parola (Argon2id), sunucu taraflı oturum (httpOnly cookie), `AuthProvider` soyutlaması, ADR-005.
- **Tenancy:** paylaşılan şema, `organization_id` her tabloda; repository fonksiyonları zorunlu `OrganizationId` (branded type) alır; org id istemciden alınmaz; cross-tenant IDOR testleri (`tenant-isolation.integration.test.ts`). ADR-001.
- **RBAC:** `packages/core/authz.ts` — rol string → izin tablosu; özel roller veri olarak eklenebilir.
- **Güvenlik:** Same-origin/CSRF kontrolü (`same-origin.ts`, proxy başlıklarına duyarlı), Redis rate limiter, Turnstile, audit log.
- **Test/CI:** Vitest 5 (unit + `*.integration.test.ts` gerçek Postgres'e karşı), Playwright + axe a11y e2e, GitHub Actions (lint, typecheck, migrate, test, build, Docker build + smoke test).
- **Deploy:** `apps/web/Dockerfile` (Next standalone), `apps/worker/Dockerfile` (tsx), Railway Variables ile yapılandırma. `railway.json/toml` yok → Dockerfile tabanlı deploy.
- **E-posta:** `deliverEmailViaProvider` soyutlaması (`console` | `resend`; `ses` rezerve ama **yok**). Mailory'nin SES sağlayıcısı sıfırdan yazılacak.
- **i18n:** next-intl, varsayılan `tr`, saat dilimi Europe/Istanbul.
- **Plan limitleri:** `plan-limits.ts` yalnızca bir limit uyguluyor; Mailory'nin entitlement modeli bundan çok daha kapsamlı olacak.

## 3. Yeniden kullanılabilir parçalar

| CiM parçası                                                                                                           | Mailory'de kullanım     | Yöntem                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| `packages/ui` (Button, Input, Field, Badge, Dialog, Sheet, Select, Dropdown, Tooltip, Checkbox, Skeleton, EmptyState) | Component system temeli | **Kopyala + uyarla** (paket adı `@mailory/ui`; CiM'e bağımlılık yok) |
| `tokens.css` (oklch token seti, radius/space ölçeği, light/dark)                                                      | Token sistemi           | Kopyala; marka rengi Mailory'e özgü yeniden tanımla                  |
| `panel.css` + sidebar/topbar/KPI row/command palette/mobile nav kalıpları                                             | Kabuk dili              | Desenleri uygula, dosyaları birebir kopyalama                        |
| `core/password.ts` (Argon2id), `authz.ts` desenleri                                                                   | Auth/RBAC               | Desen olarak yeniden yaz                                             |
| `db/tenant-scope.ts`, tenant-isolation test deseni                                                                    | Tenant izolasyonu       | Desen                                                                |
| `same-origin.ts`, `rate-limit.ts`, `turnstile.ts`                                                                     | CSRF/abuse koruması     | Kopyala + test                                                       |
| `config` Zod env doğrulaması                                                                                          | Env                     | Desen                                                                |
| Dockerfile'lar, CI workflow                                                                                           | Deploy/CI               | Uyarla (paket adları, matrix)                                        |

Kopyalama gerekçesi: CiM production sistemi; Mailory'nin ona derleme-zamanı bağımlılığı olmamalı (izolasyon + bağımsız yayın döngüsü). Ortak kod ileride gerekirse özel npm paketine taşınır.

## 4. Railway mimari audit (çıkarımsal)

CiM `INTEGRATIONS.md`/`SOCIAL_MEDIA.md`: Postgres ve Redis Railway'de çalışıyor, anahtarlar Railway Variables'da, `web` ve `worker` ayrı servisler. `same-origin.ts` ve CI smoke test'i Railway/Cloudflare proxy başlıklarına özel bir hatayı belgeliyor (Next standalone'in kendi origin'ini `0.0.0.0` raporlaması).

**Öneri:** Mailory için **ayrı Railway project** (web, worker, Postgres, Redis; ayrı env). CiM projesinde hiçbir servis/değişken/veritabanı paylaşılmaz. Bu, brief §9'un "mevcut sistemi bozma" kuralını yapısal olarak garanti eder. Maliyet artışı küçüktür ve izolasyon değerine karşılık kabul edilebilir. Gerçek Railway kurulumu hesap sahibinin kimlik bilgisi gerektirir → MAIL-160 (insan adımı).

## 5. Riskler

| #   | Risk                                                            | Etki                        | Azaltma                                                                                |
| --- | --------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| R1  | SES production access (sandbox) onayı süre alır                 | İlk gerçek gönderim gecikir | **Hemen** başvuru; geliştirmede `console`/`mock` sağlayıcı                             |
| R2  | Domain itibarı / SPF-DKIM-DMARC yanlış                          | Teslim edilebilirlik        | Deliverability Center, DKIM'i SES Easy DKIM ile doğrula, BTM için ısınma planı         |
| R3  | Çok kiracılı veri sızıntısı                                     | Güven/hukuk                 | ADR-001 deseni + zorunlu cross-tenant testler + Postgres RLS (Faz 15 sertleştirme)     |
| R4  | KVKK / açık rıza                                                | Hukuki                      | Consent alanları ilk günden, suppression, silme/dışa aktarma; hukuki görüş harici      |
| R5  | Bounce/complaint oranı SES hesabını askıya aldırır              | Platformun tamamı düşer     | Org başına bounce/complaint eşiği → otomatik duraklatma; plan bazlı kota               |
| R6  | Next.js 16 / TS 6 / Vitest 5: eğitim bilgisinden farklı API'ler | Hatalı kod                  | CiM'in `AGENTS.md` kuralı: yazmadan önce `node_modules/next/dist/docs` oku             |
| R7  | Open/click takibi (Apple MPP, bot tıklamaları) güvenilmez       | Yanıltıcı analitik          | Açılmaları "tahmini" etiketle, bot filtresi, engagement skorunda tıklama ağırlığı      |
| R8  | Kapsam şişmesi (brief çok geniş)                                | Teslim edilemez V1          | Faz sırası + "simple now" ilkesi, V1.1/V2 ayrımı (ROADMAP)                             |
| R9  | "BTM → girişimci" veri görünürlüğü                              | İzolasyon ihlali            | Varsayılan **sıfır içerik erişimi**: BTM yalnızca kullanım/durum metriği görür (D-007) |
| R10 | Railway'e erişimim yok                                          | Deploy doğrulanamaz         | Dockerfile + `/api/health` + runbook hazır; kurulum insan adımı                        |

## 6. Eksikler (CiM'de olmayan, Mailory'nin yazması gerekenler)

SES sağlayıcısı + SNS/SES event webhook doğrulaması, e-posta editörü (blok modeli + MJML/HTML render), segment motoru (AST→SQL), kampanya durum makinesi, link/open izleme, unsubscribe (RFC 8058 one-click), suppression, domain doğrulama (DNS kayıt üretimi/kontrolü), entitlement servisi, partner/sponsor hiyerarşisi (BTM→girişimci), CSV import hattı, kampanya takvimi, otomasyon motoru.

## 7. Önerilen mimari ve roadmap

Bkz. `MAILORY_ARCHITECTURE.md`, `MAILORY_DATABASE.md`, `MAILORY_ROADMAP.md`, `MAILORY_TASKS.md`, `MAILORY_DECISIONS.md`, `MAILORY_PRODUCT_SPEC.md`.
