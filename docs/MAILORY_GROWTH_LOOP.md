# Mailory: hedef, ölçüm ve sonraki adım

11 Ekim 2026 — mevcut ürüne entegre geliştirme.

## İş geliştirme yönü

Öncelikli müşteri hipotezi: küçük B2B ürün ekipleri ve hizmet girişimleri. İlk değer anı izinli kitleden ölçülebilir demo veya satış sonucu almak. Bu müşteri seçimi henüz saha verisiyle doğrulanmadı.

Kontrol grubu tek başına benzersiz bir teknoloji değildir: [Klaviyo global holdout gruplarını](https://help.klaviyo.com/hc/en-us/articles/18138290642971) destekliyor; [Mailchimp otomasyon raporları](https://mailchimp.com/help/about-customer-journey-reports/) sunuyor. Mailory'nin farklılaşma hipotezi, Türkçe ve anlaşılır bir akışta iş hedefi, hazırlanmış içerik, veri kaynağı ve ölçüm sonrası kararı birleştirmek. Satış artışı sağladığımız henüz kanıtlanmış değil.

## Uygulanan akış

1. İlk satış, demo veya yeniden etkinleştirme seçilir. Kullanıcı gerçek faydayı ve HTTPS eylem adresini girer. Marka kitiyle düzenlenebilir yerel şablon, konu ve önbaşlık hazırlanır. Şablon ile kampanya tek işlemde kaydedilir; yalnızca taslak oluşur.
2. Hedef olay `purchase`, `demo_request` veya `reactivated` olarak saklanır. Etki Motoru isteğe bağlıdır; başlangıç seçeneği %50 kontrol ve 7 gündür. Kontrol grubu gönderim almaz. Küçük kitlelerde belirsizlik giderilmiş olmaz.
3. Editör son 14 günde alınan olay adlarını, seçilen hedefin sayısını ve son alım zamanını gösterir. Bu olay akışının kanıtıdır; eksiksiz veri kapsamını veya kampanyanın yarattığı satışları kanıtlamaz. Gecikmeli olaylar alım tarihiyle sayılır; Etki Motoru gerçekleşme tarihini kullanmaya devam eder.
4. Ana ekran kurulum eksiklerini, gönderilebilir kişi bulunmamasını, açık ölçümü, mevcut taslağı ve ölçüm sonrası kararı önceliklendirir. Son üç başlayan Etki Motoru kampanyası değerlendirilir. Açık ölçüm varsa kullanıcı önce ona yönlendirilir; başka gönderimler otomatik engellenmez. Tüm geçmiş ölçümlerin çakışmadığı iddia edilmez.
5. Rapor yetersiz veri, çakışma, pozitif, negatif ve belirsiz sonuçlar için sonraki adımı açıklar. Bütçe veya gönderim otomatik değiştirilmez.

Yeniden etkinleştirme başlangıcı otomatik bir uyuyan kitle segmenti değildir. Varsayılan tüm uygun aboneler seçilir; kullanıcı göndermeden önce liste/segment/etiket seçimini gözden geçirir. Kitle Tasarruf Modu kapalıdır; abonelikten çıkanlar ve bastırılanlar mevcut kurallarla dışarıda kalır.

## Maliyet ve işletme

Yeni ücretli sağlayıcı, üretim bağımlılığı, model çağrısı veya arka plan işi eklenmedi. Maliyet mevcut web/SQL sorguları ve her başlangıç için bir şablon sürümüdür. Kaynaklar 50 olay adı, raporlar üç kampanyayla sınırlıdır. `0020_growth_signals` organizasyon/alım tarihi indeksi ekler; dağıtımda migration uygulanmalıdır. Etki Motoru için 0019 da gereklidir.

## Büyüme ölçüm planı

- Aktivasyon: hesap açılışından ilk hazır taslağa ve ilk başarılı gönderime geçen süre.
- Ölçüm kurulumu: ilk gönderimden sonraki 14 günde hedef olay alan çalışma alanlarının oranı. Kampanyayla eşleşme ayrıca doğrulanmalı.
- Tekrar kullanım: ilk ölçümden sonra ikinci kampanyayı hazırlayan çalışma alanlarının oranı.
- Birim ekonomi: aktif çalışma alanı başına gönderim, destek süresi, altyapı maliyeti ve brüt katkı. Gerçek giderlerle hesaplanmalı; fiyat veya tasarruf yüzdesi uydurulmamalı.

Bu oranların yeni kohort panosu henüz uygulanmadı. Ticari doğrulama aynı hedef segmentte kullanım görüşmeleri ve mevcut kampanya/audit/dönüşüm verileriyle yapılmalı. İnsanlarla iletişim veya ücretli kampanya başlatılmadı. Sonraki yatırım kararı ilk değer anına ulaşma ve tekrar kullanım verisine dayanmalı.

## Doğrulama

UTF-8/ICU yerel PostgreSQL üzerinde 54 dosyada 585 test geçti: gönderim, dönüşüm, Etki Motoru, veri silme, faturalama korumaları, şablonlar ve yeni hedef/büyüme akışları. Tüm paketlerin tür kontrolü ve kaynak kod denetimi geçti. Tarayıcıda ana ekran, hedefe göre taslak oluşturma, kontrol ayarının korunması ve 390px mobil görünüm doğrulandı. Canlı SES gönderimi ve üretim dağıtımı yapılmadı.
