# Envato e-posta şablonlarını Mailory'ye hazırlama — brif ve prompt

Bu belge, masaüstündeki `C:\Users\Yagiz\Desktop\MAILORY\E-MAIL NEWSLATTER` klasöründeki Envato ZIP'lerini **yerel** Claude Code ile Mailory'nin içe aktarma hattına uygun, ticari kullanımda risksiz hale getirmek için hazırlanmıştır. Bölüm 1 sizin için (önce okuyun), Bölüm 3 Claude Code'a yapıştırılacak prompttur.

## 1. Önce bilmeniz gereken lisans gerçeği (en önemli risk)

Envato lisansı (Regular/Standard) genelde **tek bir son ürüne** gömülü kullanıma izin verir; ürünü **olduğu gibi ya da küçük değişikliklerle başkalarına şablon olarak sunmayı/yeniden dağıtmayı** yasaklar. Mailory'de bu şablonları müşterilere "şablon kütüphanesi" olarak sunmak tam bu gri bölgeye düşer. Bu yüzden:

1. **Kendi e-postalarınız için kullanım** (örn. Mailory'nin kendi bültenleri, BTM kampanyaları) ile **müşterilere şablon olarak sunum** farklı konulardır. İkincisi için Envato lisansı yetmeyebilir.
2. Sunumdan önce her şablonun **Envato lisans sayfasını** ve ilgili öğenin yazarının kurallarını okuyun; emin değilseniz Envato Support'a ya da yazara **yazılı** soru sorup yanıtı saklayın. (Ben hukuki görüş veremem; avukatınıza ya da Envato'ya danışın.)
3. En güvenli yol: Envato şablonlarını **yalnızca ilham/yapı referansı** olarak kullanıp, Claude'a **sıfırdan, özgün tasarımlar** (kendi HTML'iniz, kendi görselleriniz) yazdırmak. Kütüphaneye Envato dosyasının kendisi değil, **özgün türev** girer. Brifte iki mod var: **A) Özgün yeniden yazım (önerilen)**, **B) Lisans doğrulanmış şablonu uyarlama**. Hangisini seçeceğinizi prompttaki `MOD` satırında belirtin.
4. Şablonun içindeki **fontlar, ikonlar, stok fotoğraflar** çoğu zaman ayrı lisanslıdır; bunlar otomatik olarak temizlenir/değiştirilir (aşağıda).

## 2. Mailory içe aktarma hattının kuralları (Claude Code uyumlu üretsin)

- Giriş: **tek HTML** ya da **ZIP** (HTML + görseller). ZIP sınırları: ≤15 MB, ≤500 dosya, açılmış ≤40 MB, ≤60 görsel, **görsel başına ≤1 MB** (PNG/JPG/GIF/WebP; SVG yok).
- Yalnızca **göreli yol** görseller içe aktarılır; uzak (http/https) görseller olduğu gibi kalır, indirilmez → **tüm görseller pakete yerel olmalı**, uzak adres bırakmayın.
- Güvenlik temizliği otomatik: `<script>`, olay işleyicileri (`onclick`…), `javascript:` bağlantıları, form, iframe, uzak CSS `@import`, takip pikselleri kaldırılır. Elle de bırakmayın.
- E-posta uyumu: **tablo tabanlı düzen**, satır içi (inline) stiller, genişlik ≈ 600 px, `width`/`max-width` ile mobilde tek sütun (`@media` ile), alt metin (`alt`) zorunlu, web fontu yok (Arial/Georgia/Verdana/Trebuchet/Tahoma/Courier yığınları).
- Birleştirme etiketleri (Mailory sözdizimi): `{{first_name}}`, `{{last_name}}`, `{{email}}`, `{{org_name}}`, `{{current_year}}`, `{{unsubscribe_url}}`, `{{view_in_browser_url}}`. Süzgeç/yedek: `{{first_name|dost}}`, `{{city:de|…}}` (Türkçe ekler: `e,i,in,de,den,title,upper,lower`). Otomatik eşlenen kaynaklar: Mailchimp `*|FNAME|*`, `*|UNSUB|*`, vb., `%%…%%`, `[email]`.
- **Zorunlu**: çalışan bir abonelikten çıkma bağlantısı `href="{{unsubscribe_url}}"`. Yoksa sistem düz bir alt bilgi ekler; ama şablon tasarımında hazır olsun. Fiziksel adres/gönderici bilgisi için `{{org_name}}` kullanılır; sabit firma adresi yazmayın.
- Türkçe: metin yer tutucuları **Türkçe**, "Lorem ipsum" ve yabancı marka adları kalmasın; karakter kodlaması UTF-8, `<meta charset>` olsun.
- Karanlık mod: renkleri sert kodlamayın; `color-scheme` meta + yeterli kontrast (WCAG AA).

## 3. Claude Code'a verilecek prompt (kopyalayıp yapıştırın)

> Çalışma klasörü: `C:\Users\Yagiz\Desktop\MAILORY\E-MAIL NEWSLATTER`. Başka hiçbir klasöre dokunma; orijinal ZIP'leri **asla değiştirme ya da silme** (yalnızca oku). Tüm çıktıyı `C:\Users\Yagiz\Desktop\MAILORY\HAZIR` altına yaz.
>
> **MOD:** `A` (özgün yeniden yazım)  ← gerekirse `B` yap.
>
> **Amaç:** Bu klasördeki Envato e-posta bülteni şablonlarını, Mailory (çok kiracılı e-posta pazarlama SaaS'ı) içe aktarma hattına uygun, ticari kullanımda sorun çıkarmayacak şablon paketlerine dönüştür.
>
> **Adımlar:**
> 1. **Envanter.** Her ZIP'i ayrı, boş bir geçici klasöre aç (ZIP içeriğindeki scriptleri ASLA çalıştırma; `.js`, `.php`, `.exe`, `.bat` dosyalarını yok say). Her şablon için `HAZIR\_rapor\envanter.csv` dosyasına yaz: ZIP adı, HTML dosyaları, görsel sayısı/toplam boyutu, kullanılan fontlar, ikon kütüphaneleri, uzak (http) kaynaklar, lisans/dokümantasyon dosyaları (`license.txt`, `readme`, `documentation`), şablonun yazarı/Envato öğe adı, kullanılan stok görsel/font notları.
> 2. **Lisans kaydı.** Her şablonun lisansını `HAZIR\_rapor\lisans.md` içinde özetle (hangi dosyadan okuduğunu belirt). Lisans metni bulunamıyorsa "BİLİNMİYOR" yaz. Hukuki yorum yapma; şüpheli noktaları (redistribution, stok görsel/font, "template builder'da kullanılamaz" ifadeleri) işaretle.
> 3. **Dönüştürme.** MOD A: Her şablonun *yapısını ve ilham aldığı düzeni* referans alıp **sıfırdan, özgün** HTML yaz (kopyalama yok: metin, görsel, isim, renk paleti ve bölüm dizilişi anlamlı biçimde farklı olsun). MOD B: yalnızca lisansı "uygun" olarak işaretlediklerini uyarla; yine de tüm orijinal metin/marka/görsel/ikon/yazar atıflarını kaldır.
>    Her çıktı şu kurallara uysun (Mailory içe aktarma kuralları):
>    - Tek ana HTML (`index.html`) + `images/` klasörü; hepsi ZIP'e girer (`<ad>.zip`).
>    - Tablo tabanlı düzen, satır içi stil, 600 px genişlik, mobilde tek sütun (`@media (max-width:620px)`), web fontu yok (Arial/Georgia/Verdana/Trebuchet/Tahoma/Courier), `<meta charset="utf-8">`, `<meta name="color-scheme" content="light dark">`.
>    - JavaScript, form, iframe, video/audio, `@import`, uzak CSS/font, takip pikseli, SVG **yok**.
>    - **Tüm görseller yerel**, göreli yolla (`images/x.png`), PNG/JPG/GIF/WebP, her biri ≤1 MB (gerekirse sıkıştır/yeniden boyutlandır, genişlik ≤1200 px). Görseller **özgün olmalı**: stok fotoğrafları kullanma; düz renk/degrade bloklar, geometrik desenler ya da senin ürettiğin basit illüstrasyon (PNG) kullan; yer tutucu görseller nötr olsun. Paket ≤5 MB, görsel sayısı ≤30.
>    - Tüm `<img>` etiketlerinde `alt`, `width` ve `height` olsun.
>    - Metinler Türkçe, anlamlı örnek içerik (kısa, gerçekçi). "Lorem ipsum" ve yabancı marka adı yok.
>    - Birleştirme etiketleri: selamlamada `{{first_name|değerli okurumuz}}` (ya da uygun yedek), altbilgide `{{org_name}}`, yıl için `{{current_year}}`, tarayıcıda gör bağlantısı `{{view_in_browser_url}}`, **zorunlu** `<a href="{{unsubscribe_url}}">` abonelikten çıkma bağlantısı. Sabit adres/firma adı yazma. Kaynaktaki `*|FNAME|*`, `%%firstname%%` gibi etiketleri bu biçime çevir.
>    - Bağlantılar `https://example.com/...` yer tutucu olsun (gerçek site yok).
>    - Renkler: WCAG AA kontrast; metin ≥14 px, düğmeler ≥44 px yükseklik, düğme metni açık ve eylem odaklı.
> 4. **Doğrulama (her paket için, otomatik).** Bir betikle denetle ve sonucu `HAZIR\_rapor\dogrulama.csv`'ye yaz: HTML boyutu (<100 KB önerilir; Gmail ~102 KB'tan sonra keser), yasaklı etiket/özellik taraması, uzak kaynak taraması, görsel boyutları/alt/width/height, `{{unsubscribe_url}}` varlığı, bozuk etiket/kapanmamış tablo, ZIP boyutu ve girdi sayısı limitleri. Hata varsa düzelt ve yeniden denetle; düzeltemediğini "BAŞARISIZ" olarak raporla.
> 5. **Görsel kontrol.** Mümkünse her şablonu 600 px (masaüstü) ve 375 px (mobil) genişlikte tarayıcıda render edip ekran görüntüsünü `HAZIR\<ad>\onizleme-masaustu.png` / `onizleme-mobil.png` olarak kaydet; yatay kaydırma, taşan metin, kırık görsel var mı bak.
> 6. **Metadata.** Her şablon için `HAZIR\<ad>\sablon.json`: `{ "ad": "...", "kategori": "newsletter|announcement|event|startup|product_launch|welcome|investor|corporate|marketing|recruitment|ecommerce|customer", "aciklama": "...", "mod": "A|B", "kaynak": "ZIP adı", "lisans_notu": "…", "etiketler": ["..."] }`. Ad Türkçe ve kısa olsun; Envato öğe adını kullanma.
> 7. **Son rapor.** `HAZIR\_rapor\OZET.md`: kaç şablon işlendi/başarısız, her biri için mod, lisans riski (düşük/orta/yüksek/bilinmiyor), yapılan değişiklikler, kalan manuel işler ve benim karar vermem gereken noktalar.
>
> **Yapma:** ZIP içindeki herhangi bir kodu çalıştırma; internetten stok görsel/font indirme; orijinalleri değiştirme; Envato adı, yazar adı, öğe adı ya da logosunu çıktıda bırakma; ikon fontu ya da lisanslı font dosyası paketleme; benden onay beklemeden `HAZIR` dışında dosya oluşturma.
> **Belirsiz kalırsan** varsayılanı seç, `OZET.md`'ye yaz ve devam et.

## 4. Sonraki adım (Mailory tarafı)

1. `HAZIR\*\*.zip` dosyalarını Mailory'de **Şablonlar → İçe aktar** ile yükleyin (HTML/ZIP desteklenir; uyarılar ekranda gösterilir).
2. İçe aktarma uyarısı çıkan şablonları düzeltip yeniden yükleyin.
3. Beğendiklerinizi, yüklemeyi bana bildirin: kütüphane (kodda şablonlar) olarak entegre edip testlere bağlayacağım; kendi bültenleriniz için kullanımda lisans sorunu yok.

## 5. Kendi başına karar verdiğim noktalar

- Mod A'yı önerdim (lisans riskini ortadan kaldırdığı için); Mod B yalnızca lisansı doğrulananlar içindir.
- Sınırları (1 MB görsel, 60 görsel, 15 MB ZIP) kod tabanından aldım; prompt'taki paket limitleri bunların altında tutuldu.
