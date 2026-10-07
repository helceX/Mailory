# Mailory — Decisions

Biçim: ID · Karar · Gerekçe · Alternatif · Durum. Belirsiz alanlarda brief gereği onay istenmeden karar verilmiştir; geri alınabilir olanlar işaretlidir.

| ID | Karar | Gerekçe |
|---|---|---|
| D-001 | Greenfield pnpm monorepo `apps/web`, `apps/worker`, `packages/*` (`@mailory/*`). | CiM ile aynı stack: ekip/AI bağlamı ortak, kanıtlanmış. Next.js + ayrı worker brief §10, §51 ile uyumlu. |
| D-002 | Next.js 16, React 19, Tailwind 4, Drizzle, PostgreSQL 16+, Redis + BullMQ, Zod, Vitest/Playwright. Sürümler CiM'deki sabitlerle başlar, kurulumda `pnpm view` ile doğrulanır. | Repo standardını koru (brief §10). |
| D-003 | Mailory, CiM'e **bağımlı olmaz**; kod kopyalanır (UI/auth/csrf desenleri). | Production izolasyonu, bağımsız yayın. |
| D-004 | "Media Takip Merkezi" = CiM'in giriş yapılmış paneli kabul edildi; tasarım dili: sakin, veri odaklı, Radix + token tabanlı, Plus Jakarta Sans, violet→magenta aksan. Mailory kendi marka rengini (mürekkep/indigo + sıcak aksan) ve kendi wordmark'ını kullanır; cam efektli arka plan ve gradient yoğunluğu **azaltılır** (premium + hızlı + sade). | Brief §37: "birebir kopyalama". |
| D-005 | Ayrı Railway project; CiM'in hiçbir kaynağı paylaşılmaz. | Brief §9. |
| D-006 | Tenant izolasyonu: ADR-001 deseni (zorunlu `OrganizationId` repository parametresi) + her yeni uç nokta için cross-tenant negatif test; Postgres RLS Faz 15'te ikinci katman. | Tek hata = en pahalı hata sınıfı. |
| D-007 | BTM–girişimci ilişkisi: `organizations.parent_organization_id` + `sponsorships` tablosu. BTM, çocuk org'un **kullanım/durum/onboarding metriklerini** görür; **contact, kampanya içeriği, rapor verisini görmez**. İçerik erişimi gerekirse çocuk org'un açık, iptal edilebilir, audit'li "delegated access" izniyle (V2). | Brief §4, §31: açık permission modeli. |
| D-008 | Roller: `platform_admin` (kullanıcı bayrağı, org rolü değil), `owner`, `admin`, `editor`, `viewer`. Rol→izin tablosu kodda, özel roller sonra veri olarak. | CiM ADR-005. |
| D-009 | Oturum tabanlı auth (Argon2id, httpOnly cookie, DB'de oturum), JWT yok. API anahtarları ayrı (hash'li, scope'lu). | İptal edilebilirlik. |
| D-010 | E-posta sağlayıcı soyutlaması: `EmailTransport` = `console` (dev/test, outbox tablosu) \| `ses`. SES SDK v3. Sistem e-postaları (doğrulama, davet) aynı soyutlamadan, platform kimliğiyle gider. | Gerçek hesap olmadan test edilebilirlik. |
| D-011 | SES olayları: SES Configuration Set → SNS → `POST /api/webhooks/ses`; SNS imza doğrulaması + `SubscriptionConfirmation` + `message_id` ile idempotency. Open/click kendi izleme uç noktalarımızdan (pixel + link yönlendirme), SES open/click kullanılmaz. | Link analitiği/UTM üzerinde kontrol, SES maliyeti. |
| D-012 | Kampanya gönderimi: `campaign_recipients` satırları üretilir → BullMQ batch → worker SES'e org başına hız sınırıyla gönderir. Geçici hata → üstel geri çekilme (maks 5), kalıcı → `failed`. Alıcı başına `(campaign_id, contact_id)` unique → çift gönderim yok. | Brief §11, §53. |
| D-013 | Unsubscribe: imzalı token'lı herkese açık sayfa + `List-Unsubscribe` ve `List-Unsubscribe-Post` (RFC 8058). Suppression org bazında; hard bounce ve complaint otomatik ekler. | Gmail/Yahoo gereksinimleri. |
| D-014 | Segment motoru: JSON AST (`and/or/not` + kural) → parametreli SQL (kolon beyaz listesi). Ham SQL kabul edilmez. | SQL injection, test edilebilirlik. |
| D-015 | Engagement Score: org içinde zaman-ağırlıklı (yarı ömür 30 gün) olay toplamı, 0–100 normalize; gece job'ı ile `contacts.engagement_score` önbelleği. Bantlar: ≥90, 70–89, 40–69, <40. | Basit, açıklanabilir, segmentlenebilir. |
| D-016 | E-posta editörü: JSON blok belgesi (kaynak gerçek) → sunucuda deterministik HTML render (tablo tabanlı, inline CSS) + düz metin sürümü. MJML bağımlılığı eklenmez (V1). | Test edilebilir, bağımlılık az; MJML V1.1'de değerlendirilir. |
| D-017 | AI: sağlayıcı soyutlaması (`disabled`/`mock`/`anthropic`), CiM'deki gibi. AI hiçbir zaman gönderim tetiklemez; yalnızca öneri/taslak. Kullanım `ai_credits` entitlement'ı ile ölçülür. | Brief §23. |
| D-018 | Entitlement servisi: `plans` + `plan_entitlements` + org `subscriptions` + `entitlement_overrides` (BTM sponsorlu limitleri). Limit kontrolü tek fonksiyondan (`checkEntitlement`). Ödeme sağlayıcısı yok; `billing_provider` alanı Stripe/iyzico için ayrıldı. | Brief §8, §67. Fiyatlar placeholder'dır. |
| D-019 | Fiyatlandırma V1'de uygulanmaz; yalnızca `docs/MAILORY_ROADMAP.md` "Pricing analizi" başlığı altında hipotezler (SES maliyeti + marj) tutulur. | Brief §8. |
| D-020 | Kod/UI dili: UI metinleri i18n (tr varsayılan, en), kod ve dokümantasyon başlıkları İngilizce/Türkçe karışık değil — kod İngilizce, ürün dokümanları Türkçe. | Hedef pazar TR. |
| D-021 | İlk dilim "BTM SendPulse'ın yerini alır" (Milestone 1): contacts, listeler, editör, kampanya, SES gönderimi, unsubscribe, bounce/complaint, temel analitik. AI/otomasyon sonra. | Brief §74, §70. |
| D-022 | Gerçek bulut kaynakları (Railway, SES, DNS, domain) bu oturumda **oluşturulmaz**; tüm kod bu kaynaklar olmadan test edilebilir (console transport, SNS fixture'ları). | Erişim yok + güvenlik. |
