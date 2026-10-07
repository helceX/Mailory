# MAILORY — Yayın ve işletim kılavuzu (Runbook)

Bu belge Railway kurulumunu, ortam değişkenlerini, SES/SNS bağlantısını ve günlük işletim işlerini anlatır. İnsan adımları ayrıca `MAILORY_OPEN_ITEMS.md` (A bölümü) içinde izlenir.

## 1. Mimari (Railway)

| Servis   | Kaynak                                               | Not                                                                                                                                                          |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `web`    | `apps/web/Dockerfile`, `apps/web/railway.json`       | Next.js standalone. Sağlık: `GET /api/health/ready` (DB + Redis), canlılık: `GET /api/health`                                                                |
| `worker` | `apps/worker/Dockerfile`, `apps/worker/railway.json` | BullMQ işleri: alan adı kontrolü, kampanya gönderimi, otomasyon, etkileşim skoru, saklama. **Her dağıtımdan önce migration çalıştırır** (`preDeployCommand`) |
| Postgres | Railway eklentisi                                    | Yedekleme açık olmalı (aşağıda)                                                                                                                              |
| Redis    | Railway eklentisi                                    | Kuyruk + hız sınırı; kalıcılık (AOF) önerilir                                                                                                                |

Tüm Dockerfile'lar **repo kökünden** derlenir (`docker build -f apps/web/Dockerfile .`). Railway'de her servis için "Root Directory = /" ve config dosyası yolu `apps/<servis>/railway.json` verilir.

## 2. İlk kurulum adımları

1. Railway projesi oluştur; Postgres ve Redis ekle; GitHub deposunu bağla (`main` dalı).
2. `web` ve `worker` servislerini ekle; config-as-code yolunu ilgili `railway.json`'a ayarla.
3. Ortam değişkenlerini gir (bölüm 3). `SESSION_SECRET`: `openssl rand -hex 32`.
4. Önce **worker**'ı dağıt (migration'ı o çalıştırır), sonra **web**'i. Sonraki dağıtımlarda sıra: migration geriye uyumlu (yalnızca ekleme) tutulduğu için iki servis birlikte dağıtılabilir; yıkıcı bir migration gerekirse iki aşamalı yapılır (önce kodu uyumlu hale getir, sonra kaldır).
5. Alan adını (`mailory.io`) `web` servisine bağla; `APP_URL=https://mailory.io`.
6. İlk platform yöneticisi: Railway shell'inde `apps/worker/node_modules/.bin/tsx packages/db/src/platform-admin.ts <e-posta>` (önce o e-postayla kayıt olunmuş olmalı).
7. `/platform` → "Partner kurum oluştur" ile BTM'yi aç (sahip e-postasına davet gider).

## 3. Ortam değişkenleri

Zorunlu: `NODE_ENV=production`, `APP_URL`, `SESSION_SECRET` (≥32 karakter; **değiştirmek tüm imzalı bağlantıları — abonelikten çık, izleme — geçersiz kılar, bu yüzden sabit tutulur**), `DATABASE_URL`, `REDIS_URL`.

E-posta (SES): `EMAIL_PROVIDER=ses`, `AWS_REGION`, `SES_CONFIGURATION_SET`, `SES_SNS_TOPIC_ARN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (yalnızca `ses:SendEmail` + `ses:CreateEmailIdentity/GetEmailIdentity` yetkili IAM kullanıcısı), `EMAIL_FROM`, `DOMAIN_PROVIDER=ses`, `SEND_RATE_PER_SECOND` (SES hesabının gönderim hızını aşma; sandbox'ta 1).

İsteğe bağlı: `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`, `AI_DAILY_LIMIT_PER_ORG`, `SENTRY_DSN`, `DEFAULT_TIMEZONE`, `DEFAULT_LOCALE`.

Üretimde **yasak** (uygulama başlamaz): `DNS_RESOLVER=mock`, `AI_PROVIDER=mock`.

## 4. SES + SNS bağlantısı

1. SES'te hesabı sandbox'tan çıkar (üretim erişimi talebi: kullanım senaryosu, liste edinme yöntemi, vazgeçme akışı).
2. Bir **Configuration Set** oluştur; olay hedefi olarak SNS konusu ekle (Bounce, Complaint, Delivery).
3. SNS konusuna **HTTPS aboneliği** ekle: `https://<APP_URL>/api/webhooks/ses`. Abonelik onayı uygulama tarafından otomatik yapılır (imza + sertifika ana bilgisayarı + konu ARN doğrulaması; başka konudan gelen istek reddedilir).
4. Konu ARN'sini `SES_SNS_TOPIC_ARN` olarak gir.
5. Dağıtım sonrası bir test kampanyasıyla bounce simülatörü adreslerini (`bounce@simulator.amazonses.com`, `complaint@…`) dene; olaylar kampanya ekranında ve bastırma listesinde görünmeli.

## 5. Yedekleme ve geri yükleme

- Railway Postgres otomatik yedeklerini aç; ek olarak günlük `pg_dump` önerilir (OPEN_ITEMS A4).
- Geri yükleme provası: yedeği geçici bir veritabanına yükle → `pnpm db:migrate` çalıştır → `/api/health/ready` ve bir giriş denemesi. Prova üç ayda bir yapılmalı.
- Redis kaybı veri kaybı değildir: kuyruk işleri tekrar planlanır (zamanlayıcılar worker açılışında kurulur; gönderim durumu DB'dedir, alıcı satırları yeniden talep edilir).

## 6. Günlük işletim

| Durum                                   | Ne yapılır                                                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gönderim durmuş görünüyor               | `/platform/system`: işçi sinyali ve kuyruk. Sinyal yoksa worker servisini yeniden başlat; kampanya `halt_reason` alanı nedeni söyler (`daily_limit`, `plan_limit`, `org_suspended`, `sender_unverified`, `bounce_rate`…) |
| Bounce/şikayet oranı yükseldi           | Motor %10 bounce / %0,5 şikayette kampanyayı otomatik duraklatır; Deliverability Merkezi'nden nedeni incele                                                                                                              |
| Kötüye kullanım şüphesi                 | Platform → çalışma alanı → askıya al (gerekçe zorunlu; veriler okunabilir kalır, gönderim durur)                                                                                                                         |
| Kişi silme / dışa aktarma talebi (KVKK) | Müşteri kendi başına yapar: Kişi detayı → Veri ve gizlilik. Yanıt süresi yasal 30 gün                                                                                                                                    |
| Yanlışlıkla silinen çalışma alanı       | Platform → "Silinmeyi bekleyen çalışma alanları" → Geri aç (30 gün içinde)                                                                                                                                               |
| Yeni migration                          | Worker'ın `preDeployCommand`'ı çalıştırır; başarısızsa dağıtım durur ve eski sürüm yaşar                                                                                                                                 |

## 7. Geri alma (rollback)

Railway'de önceki dağıtıma dön. Migration'lar yalnızca ekleme olduğundan eski kod yeni şemayla çalışır. Veri düzeltmesi gerekirse yedekten geri yükle (bölüm 5).

## 8. CI

`.github/workflows/ci.yml`: lint, typecheck, migrate, test (gerçek Postgres+Redis), build; ayrıca iki imajın Docker derlemesi. Tarayıcı e2e paketleri (`pnpm test:e2e`) yerelde `next dev` ile çalışır (bkz. e2e/lib.cjs); CI'a alınması OPEN_ITEMS C7'de.
