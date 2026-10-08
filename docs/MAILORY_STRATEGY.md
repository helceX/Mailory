# MAILORY — Strateji: rakiplerden neyi farklı yapıyoruz

> Rakiplerin güncel özellikleri bu belgede **doğrulanmamıştır**; aşağıdakiler analiz ve hipotezdir, gerçek kullanıcı görüşmeleriyle sınanmalıdır.

## Sorun tespiti

Mevcut araçlar **göndermeyi** iyi yapar, **sonucu** değil. Kullanıcıya editör, liste ve "Gönder" düğmesi verilir; ne yazacağına, kime/ne zaman göndereceğine ve işe yarayıp yaramadığına tek başına karar verir.

1. Ölçümler yanıltıcı: açılma oranı güvenilir değil (Apple MPP, güvenlik tarayıcıları) ama herkes onu optimize ediyor.
2. "Ne yapmalıyım?" cevapsız: araç veri gösterir, karar vermez.
3. Liste çürür, kimse söylemez: ölü adresler/spam tuzakları itibarı sessizce düşürür.
4. Fiyat teşvikleri ters: kişi sayısıyla fiyatlayan araç ölü kişileri tutmanızdan kazanır.
5. Hatalar gönderimden sonra fark edilir ("Merhaba ,", yanlış liste, bozuk bağlantı).
6. Aynı kişi birden çok kampanya/otomasyondan arka arkaya e-posta alır (kişi başı toplam sıklık sınırı çoğunlukla yok).
7. Yanıtlar çöpe gider; "çıkar beni" yanıtları şikayete dönüşebilir.
8. Türkçe ikinci sınıf: çeviri var ama ek uyumu, İYS, bayram takvimi, KVKK yok sayılır.

## Beş bahis

| #   | Bahis                                                                                                         | Durum                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | **Hedefe dayalı gönderim** — açılma değil sonuç (dönüşüm API'si, kampanya hedefi, atıf)                       | Yapım planında (aşağıda)                                                                |
| 2   | **İnsan vetolu otopsi/otopilot** — AI plan önerir, insan onaylar, asla kendi başına göndermez                 | Temel hazır (D-078); plan önerisi sırada                                                |
| 3   | **Teşvikleri hizalı fiyat** — yalnızca ulaşılabilir/etkin kişi veya gönderim hacmi; temizlik faturayı düşürür | Karar bekliyor (A12)                                                                    |
| 4   | **Gönderim güvenliği** — yorgunluk kalkanı, ön otopsi, yanıt işleme                                           | Yorgunluk kalkanı ✔, ön otopsi ✔; yanıt işleme sırada (gelen posta altyapısı gerekir) |
| 5   | **Türkiye'ye yerli** — Türkçe ek uyumu ✔, İYS, bayram takvimi, KVKK ✔, TL/e-Fatura                          | Kısmen                                                                                  |

## Yapılanlar (bu turda)

- **Türkçe ek uyumu ve ad düzeltme** (D-103): `{{first_name:e}}` → Ayşe'ye / Ali'ye / Ahmet'e / Can'a; `:in`, `:i`, `:de`, `:den`, `:title`, `:upper`, `:lower`.
- **Yorgunluk kalkanı** (D-104): kişi başına haftalık (kayan 7 gün) en fazla kampanya e-postası; sınıra ulaşan kişi o kampanyada atlanır.
- **Sonuç ölçümü** (D-106): `POST /api/v1/conversions`; kampanya raporunda dönüşen kişi, değer ve tıklama atfı.
- **Gönderim öncesi ön otopsi** (D-105): hedef kitleden zorlayıcı gerçek kişilerle (adı boş/büyük harfli/çok uzun…) e-postanın nasıl görüneceği ve neyin bozulacağı.

## Pazara giriş

1. Dar kapı: "SendPulse'tan bir günde taşı, teslim edilebilirliğini düzelt" + ücretsiz alan adı sağlık raporu (SPF/DKIM/DMARC + itibar).
2. Türkçe içerik: KVKK, İYS, Gmail/Yahoo toplu gönderici kuralları, spama düşmemek.
3. Kanallar: ajanslar (çok marka), mali müşavirler, girişim ekosistemleri (BTM gibi bir müşteri referans olur).
4. İlk 10–15 müşteriyle elle çalışarak ihtiyacı doğrula; büyük özellikleri veriyle seç.

## Riskler

- Sonuç ölçümü site tarafında dönüşüm bilgisi ister (teknik iş + KVKK/çerez).
- Paylaşılan altyapıda teslim edilebilirlik zordur; şeffaf yönetilmeli.
- "AI analisti" iddiası gerçek veriyle kanıtlanmadan vaat edilmemeli.
- Rakipler fikirleri kopyalayabilir; sürdürülebilir üstünlük hız, güven ve yerel uyum.
