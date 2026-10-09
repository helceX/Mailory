# MAILORY — Genel API (v1) ve webhook’lar

Taban adres: `https://<APP_URL>/api/v1`. Tüm yanıtlar JSON, `Cache-Control: no-store`.

## Kimlik doğrulama

Ayarlar → **Geliştiriciler** sayfasından anahtar oluşturun (yalnızca sahip/yönetici). Anahtar bir kez gösterilir; veritabanında yalnızca özeti saklanır.

```
Authorization: Bearer mlk_1a2b3c4d_<43 karakter>
```

(`x-api-key` başlığı da kabul edilir.) Anahtar tek bir çalışma alanına bağlıdır; başka alanın verisine erişemez.

| Yetki   | Neler yapabilir                                                                  |
| ------- | -------------------------------------------------------------------------------- |
| `read`  | Okuma uçları                                                                     |
| `write` | Okuma + kişi ekleme/güncelleme + liste üyeliği + bastırma listesine adres ekleme |

**API’den yapılamayanlar (bilinçli):** kampanya gönderme/zamanlama/onaylama, kişi silme, plan/üye/anahtar yönetimi. Gönderim kararı her zaman uygulamada, insan onayıyla verilir.

Anahtar, oluşturan kişinin hesabına bağlıdır: o kişi çalışma alanından çıkarsa anahtar çalışmaz (yeni anahtar oluşturulmalı).

## Sınırlar

- **Hız:** anahtar başına dakikada 300 istek (`429 rate_limited`).
- **Kota:** plandaki aylık API isteği sayısı (`api_requests`; ücretsiz planda 0). Aşılırsa `402 plan_limit`. Yalnızca kimliği doğrulanmış istekler sayılır; reddedilenler (401/403/429/402) sayılmaz.
- Başarısız kimlik doğrulama IP başına dakikada 30 ile sınırlıdır.

## Hata biçimi

```json
{ "error": { "code": "invalid_api_key", "message": "…", "requestId": "…" } }
```

| HTTP | code                              | Anlamı                                     |
| ---- | --------------------------------- | ------------------------------------------ |
| 400  | `validation_error`                | Geçersiz gövde/sorgu                       |
| 401  | `invalid_api_key`                 | Anahtar yok/yanlış/iptal edilmiş           |
| 402  | `plan_limit`                      | Plan kotası doldu                          |
| 403  | `insufficient_scope`, `suspended` | Yetki yok / çalışma alanı askıda           |
| 404  | `not_found`                       | Kayıt yok (başka çalışma alanınınki dahil) |
| 409  | `duplicate`, `suppressed`         | Zaten var / bastırma listesinde            |
| 429  | `rate_limited`                    | Hız sınırı                                 |

## Uçlar

### `GET /me`

Anahtarı doğrulamak için: `{ "organization": { "id", "name" }, "scope": "read"|"write" }`.

### `GET /contacts?limit=50&cursor=…&q=…&status=…&listId=…&tagId=…&segmentId=…&consentStatus=…`

`{ "data": [Contact], "nextCursor": string|null }` — en yeniden eskiye, imleçli sayfalama (`limit` en çok 200).

### `GET /contacts/{id}` → `Contact`

### `POST /contacts` _(write)_

Gövde: `email` (zorunlu), `firstName`, `lastName`, `company`, `position`, `website`, `phone`, `sector`, `city`, `source`, `consentStatus` (`granted`|`unknown`|`withdrawn`), `consentSource`, `custom` (özel alanlar). `source` verilmezse `api`; `consentStatus: "granted"` ise ve `consentSource` yoksa `api` yazılır — **iznin kanıtı entegratörün sorumluluğudur.** `201 Contact`. Bastırma listesindeki adres `409 suppressed`, mevcut adres `409 duplicate`.

### `PATCH /contacts/{id}` _(write)_

Kısmi güncelleme (aynı alanlar, hepsi isteğe bağlı; `custom` verilen anahtarları günceller). Bastırma listesindeki bir adrese taşınamaz/yeniden abone yapılamaz (`409 suppressed`). `consentStatus: "granted"` verilir ve `consentSource` yoksa `api` yazılır. Güncel `Contact` döner.

### `DELETE /contacts/{id}` _(write)_ — silme (KVKK)

Kişiyi kalıcı siler → `{ "deleted": 1 }`; yoksa `404`. Adres bastırma listesine **eklenmez**; bir daha asla posta almaması gerekiyorsa önce `POST /suppressions` çağırın.

### `GET /tags` → `{ "data": [{ id, name, contactCount }] }`

### `POST /tags` _(write)_ — gövde `{ "name": "…" }` (≤50 karakter) → `201 { id, name }`; aynı ad `409 duplicate`.

### `PUT /contacts/{id}/tags/{tagId}` · `DELETE /contacts/{id}/tags/{tagId}` _(write)_

Etiketi kişiye ekler (idempotent) / kaldırır → `{ "affected": n }`.

### `GET /lists` → `{ "data": [{ id, name, description, contactCount, createdAt }] }`

### `POST /suppressions` _(write)_

`{ "emails": ["a@b.co"], "reason": "unsubscribe" }` (en çok 1000) → `{ "added": n, "alreadyPresent": n }`. Başka sistemde abonelikten çıkan kişileri Mailory’ye bildirmek için.

### `POST /lists/{id}/contacts` _(write)_

`{ "contactIds": ["uuid", …] }` (en çok 100) → `{ "added": n }`. Bu çalışma alanına ait olmayan kimlikler sayılmaz. `DELETE /lists/{id}/contacts/{contactId}` → `{ "removed": 0|1 }` (kişinin kendisi silinmez).

### `GET /suppressions?q=&limit=50&offset=0`

En yeniden eskiye: `{ "data": [{ email, reason, createdAt }], "total": n }` (`limit` ≤ 200).

### `POST /conversions` _(write)_ — sonuç bildirme

Satış, kayıt gibi **gerçek sonuçları** bildirin; Mailory bunu kampanyalara atfeder ve kampanya raporunda “Sonuçlar” olarak gösterir.

```json
{
  "name": "purchase",
  "email": "ayse@ornek.com",
  "value": 249.9,
  "currency": "TRY",
  "occurredAt": "2026-06-15T12:00:00Z",
  "externalId": "siparis-1001"
}
```

`email` veya `contactId` zorunlu; `value` (varsayılan 0), `currency` (varsayılan TRY), `occurredAt` (varsayılan şimdi; gelecekte olamaz, en çok 90 gün önce) ve `externalId` isteğe bağlıdır. **`externalId` gönderin** (örn. sipariş no): aynı kimlikle tekrar çağrı çift sayılmaz (`200`, `duplicate: true`). Yanıt: `201 { id, campaignId, attribution, duplicate }`.

**Atıf kuralı:** kişinin dönüşümden önceki 30 günde **en son tıkladığı** kampanya (`attribution: "click"`); tıklama yoksa en son **aldığı** kampanya (`"send"`, yalnızca etki); hiçbiri yoksa `campaignId: null`. Atıf kayıt anında bir kez hesaplanır, sonradan değişmez. Listede olmayan kişilerin sonuçları da saklanır (atıfsız). Kişi KVKK silme talebinde silinirse sonuç kayıtları anonimleşir, kampanya toplamları kalır.

### `GET /campaigns?status=sent` → `{ "data": [{ id, name, subject, status, scheduledAt, startedAt, completedAt, createdAt }] }`

### `GET /campaigns/{id}/stats` → `{ "stats": {recipients, sent, delivered, bounced, complained, …}, "rates": {…} }`

Yalnızca toplamlar; kişi bazlı veri dönmez.

**Contact:** `{ id, email, firstName, lastName, company, position, website, phone, sector, city, status, source, consentStatus, custom, tags?, createdAt, updatedAt }`. Bu şekil sürümlüdür (`/v1`); alan eklemek uyumludur, çıkarmak/yeniden adlandırmak yeni sürüm gerektirir.

## Webhook’lar

Ayarlar → Geliştiriciler’den adres (https) ve olayları seçin. Sır (`whsec_…`) bir kez gösterilir.

| Olay                 | Ne zaman                                               |
| -------------------- | ------------------------------------------------------ |
| `email.delivered`    | Sağlayıcı teslimi onayladı                             |
| `email.bounced`      | Kalıcı (hard) bounce                                   |
| `email.complained`   | Alıcı şikayet etti                                     |
| `email.unsubscribed` | Alıcı abonelikten çıktı (`source`: `link`/`one_click`) |
| `email.opened`       | İnsan açılması (bot/önizleme hariç)                    |
| `email.clicked`      | İnsan tıklaması (`linkId`)                             |
| `ping`               | “Test gönder” düğmesi                                  |

Gövde:

```json
{
  "id": "olay-uuid",
  "type": "email.bounced",
  "createdAt": "2026-…Z",
  "data": {
    "campaignId": "…",
    "contactId": "…|null",
    "recipientId": "…",
    "email": "a@b.co"
  }
}
```

Başlıklar: `Mailory-Event`, `Mailory-Delivery` (teslimat kimliği), `Mailory-Signature: t=<unix>,v1=<hex>`.

**İmza doğrulama:** `v1 = HMAC_SHA256(secret, "<t>." + ham_gövde)` (hex). `t`’nin şimdiden 5 dakikadan eski olduğu istekleri reddedin (tekrar saldırısı). Ham gövdeyi ayrıştırmadan önce doğrulayın.

```js
const [t, v1] = header.match(/t=(\d+),v1=([0-9a-f]{64})/).slice(1);
const ok =
  crypto.timingSafeEqual(
    Buffer.from(v1, "hex"),
    crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest(),
  ) && Math.abs(Date.now() / 1000 - Number(t)) < 300;
```

**Teslimat semantiği:** en az bir kez (aynı olay tekrar gelebilir → `id` ile tekrarı eleyin); sıra garantisi yok. 2xx = başarılı; diğeri/zaman aşımı (8 sn) yeniden denenir: 30 sn, 2 dk, 10 dk, 30 dk, 2 sa, 6 sa, 12 sa (en çok 8 deneme). Yönlendirmeler izlenmez. Art arda 20 teslimat tamamen başarısız olursa uç otomatik kapatılır (nedeni sayfada görünür; yeniden etkinleştirince sayaç sıfırlanır). Teslimat kayıtları 30 gün saklanır.

**Güvenlik:** yalnızca `https://` ve genel internet adresleri kabul edilir; özel/iç ağ, bulut metadata ve döngü adresleri hem kayıtta hem bağlantı anında (DNS dahil) engellenir.
