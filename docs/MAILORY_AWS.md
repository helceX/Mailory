# MAILORY — AWS üzerinde yayın (Railway'e alternatif)

Railway yerine AWS kullanmak için hazırlanan, **tek makineli ve düşük maliyetli** kurulum. Kod değişmez; aynı Dockerfile'lar kullanılır. Hazır dosyalar: `deploy/aws/` (compose, Caddy, deploy ve yedek betikleri). Railway'e özgü olan tek şey `preDeployCommand` idi; compose'ta bunun karşılığı `migrate` servisidir.

> Durum: dosyalar yerelde doğrulandı (compose sözdizimi, betik sözdizimi). Gerçek bir AWS hesabında henüz denenmedi; ilk kurulumda küçük sapmalar çıkabilir.

## 1. Mimari

```
 Route 53 / alan adı ─► Elastic IP ─► EC2 (Docker Compose)
                                       ├─ caddy   (80/443, otomatik HTTPS)
                                       ├─ web     (Next.js)
                                       ├─ worker  (BullMQ: gönderim, otomasyon, webhook…)
                                       ├─ migrate (tek seferlik, her deploy'da)
                                       └─ redis   (AOF açık, EBS diskinde)
                 Amazon RDS Postgres ◄─┘   (yönetilen yedek, önerilen)
                 Amazon SES + SNS      ◄─ gönderim ve bounce/şikayet olayları (webhook: /api/webhooks/ses)
                 S3                    ◄─ günlük pg_dump yedekleri
```

Neden böyle: iki ürün de (Mailory, Mediaory) aynı biçimde `web + worker + Postgres + Redis`. Tek makinede Compose en ucuz yoldur; Postgres'i RDS'e koymak, kaybedilmemesi gereken tek şeyi (veriyi) yönetilen yedeğe bağlar. Trafik büyürse aynı imajlar ECS/Fargate'e taşınır; kod değişikliği gerekmez.

## 2. Tahmini aylık maliyet (yaklaşık; fiyatlar bölgeye ve zamana göre değişir — AWS Pricing Calculator ile doğrulayın)

| Kalem                                | Ucuz başlangıç                                   | Önerilen                                            |
| ------------------------------------ | ------------------------------------------------ | --------------------------------------------------- |
| EC2 (ARM `t4g.small` → `t4g.medium`) | ~$12–25                                          | ~$25–50 (`t4g.large`: iki ürün birlikte)            |
| Postgres                             | EC2 üzerinde konteyner (`--profile with-db`): $0 | RDS `db.t4g.micro/small`, tek AZ, 20–50 GB: ~$15–35 |
| Redis                                | EC2 üzerinde konteyner: $0                       | aynı                                                |
| EBS, Elastic IP, S3 yedek            | ~$3–8                                            | ~$5–10                                              |
| SES                                  | $0,10 / 1000 e-posta                             | aynı                                                |
| **Toplam (yalnızca Mailory)**        | **~$20–35**                                      | **~$45–95**                                         |

Mediaory'yi aynı makineye ayrı bir compose projesi olarak eklemek mümkün (RAM yeterliyse); ayrı makine daha güvenlidir. Mediaory ek olarak pgvector (RDS destekler), Meilisearch ve S3 kullanıyor; onun için ayrıca bir plan çıkarılmalı.

**Risk (ucuz başlangıç):** tek makine = tek hata noktası. Makine ya da disk kaybı durumunda veri yalnızca S3'teki günlük yedekten döner. Gerçek müşteri verisi için RDS'i baştan önerilir.

## 3. Kurulum adımları

1. **AWS hesabı** (kök hesaba MFA aç, günlük kullanım için IAM kullanıcı/SSO). Bölge: SES ve gecikme için `eu-central-1` (Frankfurt) uygun.
2. **Bütçe uyarısı:** Billing → Budgets → aylık $50 gibi bir eşik, e-posta bildirimi.
3. **Alan adı:** Route 53 ya da başka bir kayıt kuruluşu. `A` kaydı → Elastic IP.
4. **EC2:** Ubuntu 24.04 ARM, `t4g.medium`, 30 GB gp3. Güvenlik grubu: 22 (yalnızca kendi IP'niz), 80, 443. **Elastic IP** bağla.
5. **IAM rolü (instance profile)** — erişim anahtarı **kullanmayın**, role verin: SES için `ses:SendEmail`, `ses:SendRawEmail`, `ses:CreateEmailIdentity`, `ses:GetEmailIdentity`; yedek için `s3:PutObject` (yedek kovası). Uygulama AWS SDK varsayılan kimlik zincirini kullanır, bu yüzden `.env`'de anahtar gerekmez.
6. **RDS (önerilen):** PostgreSQL 16, tek AZ, otomatik yedek 7 gün, "Public access: No"; güvenlik grubunda yalnızca EC2'nin güvenlik grubuna 5432 izni. `DATABASE_URL` sonuna `?sslmode=require`.
7. **Makinede:**
   ```bash
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git awscli
   sudo usermod -aG docker $USER   # çıkış/giriş
   sudo git clone https://github.com/helceX/Mailory.git /opt/mailory && cd /opt/mailory
   git checkout main              # Railway'deki gibi izlenecek dal
   cd deploy/aws && cp .env.example .env && nano .env
   ./deploy.sh
   ```
8. **SES + SNS:** `docs/MAILORY_RUNBOOK.md` bölüm 4 aynen geçerli (sandbox'tan çıkış talebi, Configuration Set, SNS HTTPS aboneliği → `https://<alan-adı>/api/webhooks/ses`). Sandbox çıkışı günler sürebilir; erken başlatın.
9. **İlk yönetici:** `docker compose exec worker apps/worker/node_modules/.bin/tsx packages/db/src/platform-admin.ts <e-posta>` (önce o e-postayla kayıt olunmuş olmalı).
10. **Yedek:** `crontab -e` → `17 3 * * * cd /opt/mailory/deploy/aws && BACKUP_BUCKET=<kova> ./backup.sh >> /var/log/mailory-backup.log 2>&1`. S3 kovasına 30–90 günlük yaşam döngüsü kuralı ekleyin. Geri yükleme provasını üç ayda bir yapın (runbook bölüm 5).
11. **Şablonları yükleme** (131 paket): makinede, `.env` içindeki `DATABASE_URL` ile
    `docker compose run --rm -v /opt/mailory:/repo -w /repo worker apps/worker/node_modules/.bin/tsx scripts/import-template-packs.ts --org <uuid> --dry-run` (önce deneme, sonra `--dry-run`suz). Betik kökte `tsx` ve çalışma kopyası ister; makinede `pnpm install` yapıp doğrudan `pnpm templates:import --org <uuid>` çalıştırmak daha basittir.

## 4. Günlük işletim

- Deploy: `cd /opt/mailory/deploy/aws && ./deploy.sh` (çekme → derleme → migration → yeniden başlatma → sağlık kontrolü).
- Günlükler: `docker compose logs -f web worker`. Sağlık: `https://<alan>/api/health/ready`.
- Geri alma: `git checkout <önceki-commit>` + `./deploy.sh` (migration'lar yalnızca ekleme olduğundan eski kod yeni şemayla çalışır).
- Güvenlik güncellemeleri: `sudo unattended-upgrades` açık tutun; Docker imajlarını deploy'da yeniden derleyin.
- İzleme (ucuz): CloudWatch makine alarmı (CPU, disk), dış sağlık denetimi (UptimeRobot vb.), `/platform/system` işçi sinyali.

## 5. Daha sonra (büyüyünce)

ECS Fargate (web + worker ayrı görevler), ElastiCache (Redis), ALB + ACM sertifikası, GitHub Actions ile ECR'ye imaj ve otomatik deploy. İmajlar zaten Dockerfile'larla hazır; yalnızca altyapı tanımı eklenir.
