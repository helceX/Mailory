# Mailory — Database Architecture

PostgreSQL 16+, Drizzle. Kurallar: `uuid` PK (`defaultRandom`), `timestamptz`, tenant tablolarında `organization_id NOT NULL` + `ON DELETE CASCADE` (soft-delete edilen org hariç, bkz. §9), durum alanları `text` + CHECK (enum değişimi migration gerektirmesin), e-posta `lower(email)` üzerinde unique.

## 1. Identity

- `users` (id, email unique-lower, password_hash, first_name, last_name, email_verified_at, is_platform_admin, disabled_at)
- `sessions` (id, user_id, token_hash unique, active_organization_id, ip, user_agent, expires_at, revoked_at)
- `organizations` (id, name, slug, type `standard|partner`, **parent_organization_id** → organizations, default_timezone, deleted_at)
- `memberships` (organization_id, user_id, role `owner|admin|editor|viewer`, status `active|revoked`, invited_by) — unique(org,user); role/status CHECK kısıtlı
- `invitations` (organization_id, email, role `admin|editor|viewer`, token_hash unique, invited_by, expires_at, accepted_at, revoked_at) — aynı e-postaya yeni davet eskisini iptal eder
- `user_tokens` (user_id, purpose `verify_email|reset_password`, token_hash unique, expires_at, consumed_at) — D-026
- `email_outbox` (sistem e-postaları: to, subject, body, kind, sent_at, delivered_via, last_error)

## 2. Billing / entitlements

- `plans` (key `free|starter|growth|pro|enterprise|btm_sponsored`, name, is_public)
- `plan_entitlements` (plan_key, entitlement_key, limit_value bigint NULL=sınırsız) — anahtarlar: `contacts`, `emails_per_month`, `members`, `automations`, `storage_mb`, `ai_credits`, `api_requests`
- `subscriptions` (organization_id, plan_key, status `active|trialing|paused|canceled`, source `manual|sponsored|stripe`, sponsor_organization_id NULL, current_period_start/end, billing_provider, billing_customer_id, billing_subscription_id)
- `entitlement_overrides` (organization_id, entitlement_key, limit_value, reason, set_by) — sponsorlu limitler burada
- `usage_counters` (organization_id, key, period_start, value) — unique(org,key,period_start); `emails_per_month` worker'da artırılır
- `invoices` (organization_id, provider_invoice_id, amount, currency, status, issued_at) — V2 dolar

Etkin limit = override ?? plan_entitlement. Tek giriş: `checkEntitlement(orgId, key, delta)`.

## 3. Audience

- `contacts` (organization_id, email, first_name, last_name, company, position, website, phone, sector, city, status `subscribed|unsubscribed|bounced|complained|cleaned`, consent_status `granted|unknown|withdrawn`, consent_source, consent_at, unsubscribed_at, source, custom jsonb, engagement_score smallint, last_activity_at, created_at) — unique(org, lower(email)); indeksler: (org, status), (org, engagement_score), GIN(custom jsonb_path_ops) gerekirse
- `contact_fields` (organization_id, key, label, type `text|number|date|boolean|select`, options jsonb) — kullanıcı tanımlı alanlar; değerler `contacts.custom`'da
- `lists` (organization_id, name, description; ad org içinde case-insensitive tekil) · `list_contacts` (list_id, contact_id, organization_id, added_at) PK(list_id, contact_id)
- `tags` (organization_id, name) · `contact_tags` (contact_id, tag_id, organization_id)
- `segments` (organization_id, name, definition jsonb AST, last_count, last_counted_at)
- `suppressions` (organization_id, email_lower, reason `unsubscribe|hard_bounce|complaint|manual|import`, source_campaign_id, created_at) — unique(org, email_lower). Gönderim öncesi kontrolün tek kaynağı.
- `import_jobs` (organization_id, user_id, status, file_key, mapping jsonb, total, inserted, updated, skipped, errors jsonb, consent_attested bool, consent_attested_at)

## 4. Email

- `sender_domains` (organization_id, domain unique-lower **global** (aynı domain iki org'da olamaz), status `pending|verified|failed`, dkim_tokens jsonb, spf_ok, dkim_ok, dmarc_policy, last_checked_at, verified_at)
- `sender_identities` (organization_id, sender_domain_id NULL, from_name, from_email, reply_to, is_default, verified_at)
- `brand_kits` (organization_id unique, logo_key, colors jsonb, fonts jsonb, button_style jsonb, footer_html, social_links jsonb)
- `templates` (organization_id, name, category, scope `org|library|partner_shared`, source_template_id, archived_at, current_version_id) · `template_versions` (template_id, organization_id, version, doc jsonb, note, created_by) — değişmez; HTML/metin saklanmaz, render'da üretilir
- `campaigns` (organization_id, name, status, sender_identity_id, reply_to, subject, preheader, template_version_id, content_snapshot jsonb, audience jsonb `{list_ids, segment_id, exclude…}`, tracking jsonb `{opens, clicks}`, utm jsonb, scheduled_at, started_at, completed_at, created_by, submitted_by, approved_by, approved_at, ab_test jsonb NULL)
- `campaign_recipients` (campaign_id, organization_id, contact_id, email, status, ses_message_id, attempts, last_error, queued_at, sent_at, delivered_at, bounced_at, complained_at) — unique(campaign_id, contact_id); indeks (campaign_id, status)
- `links` (campaign_id, organization_id, url, position) · `link_clicks` (link_id, recipient_id, organization_id, clicked_at, device, ip_hash, country, is_bot)
- `email_events` (organization_id NULL-able bilinmeyen, provider_event_id unique, type `send|delivery|bounce|complaint|reject|open|click|unsubscribe`, recipient_id, payload jsonb, occurred_at) — aylık partisyon adayı
- `campaign_stats` (campaign_id, organization_id, sent, delivered, opens_unique, clicks_unique, bounced, complained, unsubscribed, updated_at) — artımlı toplama
- `email_outbox` (sistem e-postaları, console transport için)

## 5. Automation (V2)

`automations` (org, name, status, trigger jsonb) · `automation_nodes` (automation_id, org, type `condition|delay|email|branch`, config jsonb, next jsonb) · `automation_runs` (automation_id, contact_id, org, status, current_node_id, resume_at) · `automation_actions` (run_id, node_id, org, result, executed_at)

## 6. Forms (V2)

`forms`, `form_fields`, `form_submissions` (hepsi organization_id ile)

## 7. Platform

`audit_logs` (organization_id NULL, user_id, action, entity_type, entity_id, ip, user_agent, metadata jsonb, created_at — append-only; org silinse de korunur: FK **yok**, `organization_id` düz uuid) · `notifications` · `api_keys` (organization_id, name, prefix, key_hash, scopes text[], last_used_at, revoked_at) · `webhooks` (org, url, secret_enc, events text[]) · `integrations` · `sponsorships` (partner_organization_id, organization_id, plan_key, contact_limit, email_limit, status, created_by) · `ai_usage` (org, kind, tokens, credits, created_at)

## 8. İndeks ve ölçek notları

Tüm sayfalama keyset (`(created_at,id)`). `contacts` 1M için: (org, lower(email)) unique, (org, status, id), (org, engagement_score, id). `campaign_recipients` ve `email_events` büyüyen tablolar → partisyon ve arşiv politikası Faz 15.

## 9. Silme ve KVKK

Org silme = soft delete (`deleted_at`) + zamanlanmış kalıcı silme job'ı. Contact silme = hard delete + e-posta `suppressions`'ta _hash olarak_ korunur (yeniden eklenmesin diye, yalnızca org istiyorsa). Dışa aktarma: contact başına JSON/CSV (olaylarla). `audit_logs` kişisel veri içermez (e-posta yerine contact_id).

## 10. RLS planı (Faz 15)

Tenant tablolarına `ENABLE ROW LEVEL SECURITY` + `app.org_id` politikası; uygulama rolü `BYPASSRLS` değil; platform/partner görünümleri `SECURITY DEFINER` görünümleri üzerinden.

## Faz 4 notları

- `list_contacts`/`contact_tags` satırları `organization_id` taşır; ekleme `INSERT … SELECT` ile yapılır ve liste/etiket aynı org'a ait olmak zorundadır — yabancı id sessizce 0 satır etkiler.
- Drizzle'da tablo `listContactLinks` olarak dışa aktarılır (SQL adı `list_contacts`); `listContacts` repository fonksiyonudur.
- `import_jobs` içe aktarma özetini, ilk 50 hatayı ve izin beyanının kanıtını (`consent_attested_at`, kullanıcı) tutar.
- `suppressions.reason`: unsubscribe | hard_bounce | complaint | manual | import.

## Faz 5 notları

- `assets` (organization_id, content_type, size, sha256, filename, data bytea, created_by): yalnızca doğrulanmış raster görseller; herkese açık okuma `getAssetPublic(id)` (uuid kimlik bilgisidir), yazma/sayım tenant-scoped.
- `brand_kits` (organization_id **unique**, logo_asset_id → assets, renkler, font, button_radius, footer_text, social_links jsonb). Başka org'a ait logo kimliği bağlanmaz (yoksayılır).
- `templates`: `unique(organization_id, lower(name)) WHERE archived_at IS NULL` (kısmi); `current_version_id` düz uuid (döngüsel FK yok).
- Kütüphane şablonları DB'de değil, kodda (`packages/email/src/library.ts`).

## Faz 6 notları

- `sender_domains`: org'a ait; `domain`, `status` (pending/verified/failed), `dkim_tokens[]`, `ownership_token`, `ownership_ok/dkim_ok`, `spf_state/dmarc_state`, `snapshot` (son DNS sonucu), `failing_since`, `last_checked_at`, `verified_at`. (organization_id, domain) tekil; **doğrulanmış** satırlar için domain üzerinde kısmi unique index (tek sahip).
- `sender_identities`: org'a ait gönderici (ad, e-posta, yanıt adresi, varsayılan). Varsayılan kimlik org başına tek (`FOR UPDATE` ile değiştirilir); silinen varsayılanın yerine en eski kalan terfi eder. Kullanılabilirlik veri değil, doğrulanmış kapsayan alan adından hesaplanır.
- Migration: `0004_nostalgic_jazinda.sql`.
