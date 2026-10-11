# Mailory Etki Motoru — entegre V1

Kampanya oluşturma, onay/zamanlama, gönderim işçisi, kampanya raporu ve public stats API'sine entegredir. Ayrı pilot uygulaması veya ücretli model servisi değildir. Kullanıcı kampanya kitlesinde açar; eski kampanyalarda kapalıdır.

## Kullanım

1. Kampanya taslağında hedef kitlenizi seçin. İsterseniz önce Kitle Tasarruf Modu uygulanır.
2. **Etki Motoru / Gerçek ek etkiyi ölç** seçeneğini açın. Hedef olay adını dönüşüm API'sindeki `name` ile aynı yazın (`purchase`, `demo_request` vb.). Kontrol oranını %10/%20/%50, pencereyi 7/14/30 gün seçin.
3. Kaydet: uygun kişi, gönderim ve kontrol sayıları gösterilir. Kontrol sayısı sıfırsa zamanlama engellenir. Az örneklemde deney yapılabilir, fakat sonuç yönü ilan edilmez.
4. Normal onay/zamanlama akışını kullanın. Ayarlar onay ekranında görünür ve taslak dışına çıktıktan sonra değiştirilemez. Kopyalama ayarları korur; yeni kampanya yeni gruplar üretir.
5. `POST /api/v1/conversions` ile hedef olayları **her iki grubun tamamından**, e-posta tıklamasına bağlı olmadan gönderin. `externalId` ile tekrarları önleyin. Satın alma/demo sunucu olaylarını kullanın; kampanya ID'si veya tıklama koşulu gerekmez.
6. Kampanya raporunda grup büyüklüğü, dönüşen kişi, oran farkı, belirsizlik, pencere bitişi ve çakışmaları görün. Public `GET /api/v1/campaigns/{id}/stats` aynı toplu `impact` nesnesini döndürür; kişi verisi içermez. Etki kapalı veya başlamamış kampanyalarda `impact: null`.

## Gönderim ve ölçüm sözleşmesi

Atama gönderim başlangıcında canlı, abone ve bastırılmamış kitle üzerinden yapılır. Kampanya UUID'si ve kişi UUID'sinin MD5 sıralaması her kampanyaya özgü sözde rastgele sıra üretir. Kontrol sayısı `floor(uygun_kitle * oran / 100)`; kalanlar treatment grubudur. Bu bir kriptografik rastgelelik iddiası değildir. Liste/etiket/segment ve tasarruf koşulları atamadan önce her iki grup için aynıdır.

Durum geçişi, grup ataması ve treatment alıcılarının oluşturulması aynı veritabanı transaction'ında tamamlanır. Başarısızlıkta kampanya scheduled kalır ve sonraki işçi tekrar deneyebilir. Kampanya satır kilidi ve benzersiz indeks eşzamanlı tekrarları önler. Atama yapıldıktan sonra yeni kişiler gruba eklenmez. **Kontrol grubunun campaign_recipients kaydı yoktur:** gönderim işçisi, retry, kota ve teslimat olayları bu kişilere kampanyayı gönderemez. İşlem e-postaları değişmez.

Payda tüm atanmış kişilerdir (intention-to-treat). Sonradan gönderimi atlanan/başarısız olanlar çıkarılmaz. Seçilen hedef için pencere içinde en az bir dönüşüm yapan kişi bir kez sayılır; attribution/campaign_id gerekli değildir. Değer ve farklı para birimleri birleştirilmez; V1 etki metriği dönüşen kişi oranıdır. Süre gönderim başlangıcından ölçülür; uzun kota gecikmeleri etkiyi zayıflatabilir. Geç bildirilen olaylar kendi occurredAt zamanına göre pencere içinde kabul edilir.

Rapor hesaplaması tek toplu SQL sorgusudur: zaman/hedef ile daraltılan olaylar ve gönderimler ortak CTE'lerde toplanır, contact_id/email eşleşmesi union ile tekilleştirilir. Her kişi için ayrı sorgu veya ücretli model çağrısı yok. Yeni conversions hedef/zaman indeksi ve cohort benzersiz indeksi vardır. Büyük ölçekte gerçek sorgu planlarıyla yük testi ayrıca gerekir.

## Sonucun anlamı ve sınırlar

- Pencere açık: **Ölçüm sürüyor**; otomatik kazanan veya gönderim değişikliği yok.
- Her kolda en az 50 kişi ve toplam 20 dönüşüm yok: **Yeterli veri yok**. Bunlar ürünün muhafazakâr eşikleridir; güç analizi değildir.
- Pencere kapalı, kampanya tamamlanmış, veri çakışmasız ve eşikler sağlanmışsa Wilson grup sınırları farkından geniş bir belirsizlik aralığı hesaplanır. Aralık sıfırı içeriyorsa **Belirsiz**, tamamen bir yöndeyse **Pozitif/negatif sinyal**. Bu aralık kesin bir %95 fark güven aralığı veya gelir garantisi değildir. Sürekli bakarak erken karar verilmez.
- Pencere içinde başka Mailory kampanyası/otomasyonundan gönderim veya kişi kimliğinin silinmesi varsa ya da kampanya tamamlanmamışsa yön sinyali yerine **Güvenilir sonuç çıkarılamıyor** gösterilir. Bu kişiler paydadan çıkarılmaz. Mailory dışındaki gönderimler ve eksik müşteri olayları tespit edilemez.
- Hedef olay kaynağı sadece e-postaya tıklayanlardan veri gönderiyorsa test yanlıdır. Hiç olay olmaması, sıfır dönüşüm ile bozuk entegrasyonu ayırt etmez. V1 entegrasyon sağlığını doğrulamış sayılmaz; ekran bunu açıklar.
- Birden çok deneye göre otomatik kişi seçimi, uplift modeli, farklı teklif optimizasyonu ve kendi başına karar verme V1'de yoktur. Önce ölçüm altyapısı kurulmuştur.

## Veri hakları ve dağıtım

Grup kayıtları veri dışa aktarımına dahildir. Kişisel veri silme akışı cohort e-postasını anonimleştirir, contact_id bağlantısını kaldırır; etkilenen rapor güvenilir sonuç vermez. Kurum/kampanya silinmesinde kayıtlar cascade temizlenir. Rapor servisi mevcut analytics yetkisi ve kiracı kontrolünü kullanır.

`0019_campaign_impact.sql` ve şema snapshot'ı repodadır. **Yeni web/worker başlamadan migration uygulanmalıdır**; mevcut AWS deploy akışı migration tamamlanmasını bekler. Eski kampanyaların audience JSONB alanına zorunlu yeni alan eklenmez. Yeni dış servis, API anahtarı veya üretim bağımlılığı yok; cohort satırları, indeks ve toplu raporlama mevcut DB kaynaklarını tüketir.

## İstatistik kaynakları

## Doğrulama

371 test geçti: gerçek yerel PostgreSQL üzerinde iki grubun tam sayısı, concurrent/idempotent atama, hata sonrası transaction rollback, gönderim işçisinin kontrol grubuna hiç göndermemesi, atıfsız kontrol dönüşümleri, kişi tekilleştirme, hedef/zaman/kiracı filtreleri, başka kampanya çakışması ve veri silme/dışa aktarım. Tüm workspace tür kontrolü ve değişen kodların lint kontrolü geçti. Chrome ile gerçek yerel Next.js uygulamasında ayar kaydet/yenile ve sonuç raporu, masaüstü/390 px mobil görünüm ve taşma kontrolü doğrulandı. Canlı AWS dağıtımı veya gerçek müşteri e-postası gönderimi yapılmadı.

### Kaynaklar

- [NIST: binomial oranlar için Wilson sınırları](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)
- [Microsoft Research: deney metriklerinin yorumlama hataları](https://www.microsoft.com/en-us/research/publication/a-dirty-dozen-twelve-common-metric-interpretation-pitfalls-in-online-controlled-experiments/)
