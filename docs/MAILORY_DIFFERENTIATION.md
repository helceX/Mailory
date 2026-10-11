# Mailory: düşük maliyetle farklılaşma

Karar tarihi: 11 Ekim 2026. Önerilen konum: **küçük girişimler için daha az gereksiz gönderim, anlaşılır hazırlık kontrolü ve ölçülen sonuç**. Aynı dönüşümü daha az gönderimle elde ettiğimizi henüz kanıtlamadık.

## Genel yapı

Entegre **Etki Motoru V1** artık kampanya ayarları, gönderim ve raporlama içindedir: [MAILORY_IMPACT_ENGINE.md](MAILORY_IMPACT_ENGINE.md). Bu, kontrol grubuyla ölçüm altyapısıdır; kişi bazlı uplift modeli veya otomatik karar verme henüz uygulanmamıştır.

Next.js web + PostgreSQL + Redis/BullMQ işçi + SES düzenini koruyalım. Çok kiracılı yetkilendirme, kuyruk, bastırma ve abonelik kontrolleri, alan adı doğrulaması, haftalık kişi sınırı ve dönüşüm API'si mevcut. Yeni mikroservis, vektör veritabanı ve sürekli LLM gerekmez. Asıl fırsat bu parçaları girişimin ilk kampanyasında anlaşılır karar akışına dönüştürmek.

Mailchimp'te segmentasyon, otomasyon, gelir raporlaması ve AI; MailerLite'ta otomasyon, AI ve Smart Sending zaten var. “AI ile mail yazıyoruz” farklılaşma değildir. Resend'in geliştirici odaklı işlem e-postası planı tam pazarlama ürünümüzle aynı kapsamda değildir.

İlk paket: Türkçe kişiselleştirme + gerçek kişilerle gönderim öncesi kontrol + isteğe bağlı kitle tasarrufu + dönüşüm raporu. Parçalar ayrı ayrı benzersiz değildir. Avantaj hipotezi kurulum kolaylığı, açık kurallar, destek ve toplam maliyettir.

## Öncelik sırası

| Sıra | Öneri                                                           | Maliyet / durum                                      | Başarı ölçüsü                                              |
| ---- | --------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| 1    | Kampanya başına Kitle Tasarruf Modu                             | Uygulandı; mevcut SQL, ücretli dış API yok           | Seçilen kitle ile oluşturulan alıcılar aynı kurala dayanır |
| 2    | HTML boyutu, okunma süresi, kesilme uyarısı                     | Uygulandı; yerel içerik ölçümü, LLM yok              | UTF-8 bayt; 80/102 KB bantları; 200 kelime/dakika          |
| 3    | İlk satış / demo / yeniden etkinleştirme için üç rehber         | Sonraki pilot; statik şablon + mevcut dönüşüm API'si | İlk kampanya hazırlama süresi, dönüşüm kurulum oranı       |
| 4    | Rehberli taşıma: örnek CSV, izin beyanı, bastırma ve DNS raporu | Sonraki pilot; mevcut import/DNS araçları            | İlk başarılı aktarım süresi, destek talepleri              |
| 5    | Platform maliyet görünümü ve kurum bütçe uyarısı                | Sonraki altyapı işi; mevcut kullanım + birim maliyet | SES faturasıyla kalibre edilen tahmin; sabit giderler ayrı |

Şimdilik inbound yanıt sınıflandırma, görsel AI, ayrı dedicated IP, her kampanyada LLM analisti ve çok kanallı CRM açmayalım. Sağlayıcı maliyetini ve destek kapsamını büyütürler. AI mevcut sistemde isteğe bağlı kalsın (`AI_PROVIDER=none`); ücretli kullanım kota ve ölçümle açılsın.

## Uygulanan davranış

`CampaignAudience.excludeDormant` isteğe bağlıdır; eski kampanyalarda kapalı kalır. Mevcut 90 günlük engagement skoru tam sıfır olanları yalnızca bu kampanyadan çıkarır. Null skorlar ve pozitif düşük skorlar korunur. Liste/etiket/segment, kiracı sınırı, abonelik ve bastırma koşulları birlikte uygulanır. Kişi silinmez veya abonelikten çıkarılmaz. Yeniden etkinleştirme kampanyasında mod kapatılmalıdır.

Engagement ölçülen etkileşimdir; kapalı izleme ve istemci engelleri gerçek ilgiyi gizleyebilir. Bu yüzden otomatik açılmaz ve aynı gelir garantisi verilmez. Alıcılar gönderim başlangıcında oluşturulur; kişi durumları değişebilir, haftalık sınır da sonradan atlama yapabilir. Önizleme nihai teslim edilen sayı değildir.

Hazırlık servisi mevcut engagement toplamasından karşılaştırma ve seçilen sayıyı üretir; ayrı tam kitle sayımı kaldırıldı. İşçi aynı filtreyi kullanır. JSONB audience alanı sayesinde yeni tablo veya veritabanı geçişi yok.

İçerik ölçümü önizleme HTML'inin UTF-8 boyutudur; uzaktaki görsel dosyaları dahil değildir. Kişiselleştirme, takip URL'leri ve taşıma kodlaması nihai boyutu büyütebilir. Gmail'in yaklaşık 102 KB kesme sınırı için 80 KB'dan itibaren erken uyarı verilir. Bu, istemci testi veya gelen kutusu garantisi değildir. Okunma süresi düz metindeki URL'ler hariç kelimelerden tahmin edilir.

## Maliyet gerçeği

SES resmi temel dış gönderim fiyatı 1.000 e-posta başına $0,10; gönderim verisi ayrıca $0,12/GB. 100.000 gönderimin yalnızca temel SES kalemi $10, 20.000 daha az gönderimin bu kalemde etkisi $2'dir. Ek ürünler, altyapı, vergiler ve krediler ayrıca değerlendirilir. Tasarruf modunu büyük dolar tasarrufu diye pazarlamayalım.

Erken aşamada sunucu/veritabanı/Redis, yedekleme, izleme, destek ve müşteri edinme giderleri daha belirleyici olabilir. Müşteriye ayrı sunucu açmadan ortak altyapıyı kullan; kuyruğu ve tablo büyümesini izle, trafik oluşmadan ön ölçekleme yapma. Görsellerin mevcut PostgreSQL depolamasını kota ile sınırla; DB/backup yükü yükselince mevcut URL sözleşmesiyle object storage'a taşı.

Aylık hesap: sabit nakit gider + SES gönderim/veri gideri + AI + diğer değişken servisler; müşteri başına destek saatini ayrıca kaydet. Fiyat tabanını katkı marjıyla belirle. Freemium/sponsorlu hesaplara mevcut kotaları uygula; sınırsız kullanım vaat etme. Bu pakette yeni ücretli sağlayıcı, kalıcı servis veya üretim bağımlılığı eklenmedi; mevcut CPU/DB tüketimi sıfır değildir.

## Pilot ve doğrulama

5–10 gönüllü girişimde iki hafta: tasarruf tercihi, önlenen gönderim, hazırlama süresi, destek zamanı, 1.000 gönderim başına dönüşüm ve toplam dönüşüm ölçülsün. Farklı kampanyaların farklı kitlelerini karşılaştırmak nedensel kanıt oluşturmaz; aynı sonuç iddiası için kontrollü deney gerekir. Açılma oranı tek başarı ölçüsü olmasın.

291 test geçti; gerçek yerel PostgreSQL üzerinde kayıt, karşılaştırma, sabitlenen sayı, kopyalama, idempotent alıcı oluşturma, liste/etiket/segment ve yabancı kiracı erişimi doğrulandı. Tüm çalışma alanı tür kontrolü ve değişen kodların lint kontrolü geçti. Gerçek yerel Next.js uygulamasında Chrome ile aç/kapat, kaydet/yenile, içerik ölçüleri ve 390 px mobil taşma kontrolü geçti; masaüstü/mobil ekran görüntüleri incelendi. Canlı SES gönderimi ve AWS dağıtımı yapılmadı.

## Resmi kaynaklar

- [Mailchimp özellikleri](https://mailchimp.com/features/)
- [MailerLite email marketing](https://www.mailerlite.com/features/email-marketing)
- [Resend fiyatları](https://resend.com/pricing)
- [Amazon SES fiyatları](https://aws.amazon.com/ses/pricing/)
- [Gmail kesilme sınırı](https://mailchimp.com/help/gmail-is-clipping-my-email/)
