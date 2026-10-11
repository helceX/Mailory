# Mailory şablon dönüşümü — Özet

**İşlenen:** 131 / 131 ZIP · **Başarısız:** 0 (otomatik doğrulama: bkz. `dogrulama.csv`; tarayıcı render: 262 ekran, yatay kaydırma/kırık görsel yok) · **Mod:** hepsi A

## Kritik bulgu
- 131 ZIP'in **hiçbirinde hazır e-posta HTML'i yok**. İçerikler PSD/XD/Figma/Sketch/InDesign tasarım dosyaları, JPG/PNG önizlemeler ve notlar. Tek "HTML" içeren ZIP (107) yalnızca yardım/dokümantasyon sayfası.
- Bu yüzden MOD B (uyarlama) mümkün değildi; PSD/XD içeriği okunmadı/kopyalanmadı. MOD A'da kaynaktan **yalnızca dosya adından çıkan sektör/kategori ipucu** kullanıldı. Şablonların düzeni, metni, renkleri, görselleri benim yazdığım 8 özgün düzen arketipinden ve algoritmik üretilen geometrik PNG'lerden gelir (stok görsel/font yok, indirme yok).
- Hiçbir ZIP'te lisans dosyası yok → lisans her yerde **BİLİNMİYOR** (`lisans.md`). PDF dokümanlar (19 adet) okunmadı, bu yüzden "şüpheli ifade" taraması yalnızca .txt notlarında yapıldı. Kaynak riski bilinmiyor; çıktılar özgün olduğu için çıktı riski düşük (hukuki yorum değildir).

## Yapılanlar
- Envanter: `envanter.csv`; lisans: `lisans.md`; doğrulama: `dogrulama.csv`.
- Her şablon: `HAZIR/<ad>/` içinde `index.html`, `images/`, `<ad>.zip`, `sablon.json`, `onizleme-masaustu.png` (660 px), `onizleme-mobil.png` (375 px).
- Kurallar: tablo düzeni, satır içi stil + 620 px medya sorgusu, sistem fontları, JS/form/SVG/uzak kaynak yok, `{{first_name|…}}`, `{{org_name}}`, `{{current_year}}`, `{{view_in_browser_url}}`, `{{unsubscribe_url}}`, bağlantılar example.com, düğmeler 48 px, metin ≥14 px, kontrast ≥4.5 (palet çiftleri hesaplandı).
- Tüm HTML'ler 5–10 KB, ZIP'ler küçük (çoğu <200 KB).

## Varsayımlar / sizin kararınız
1. **Sektör/kategori** dosya adından tahmin edildi; adı sektör belirtmeyen 77 ZIP'e (ör. "email-newsletter-2023-…") sektör/kategori sırayla atandı. Ad ve `kategori` alanlarını gözden geçirin.
2. **Çeşitlilik sınırı:** 8 düzen arketipi × palet/font/desen/metin varyasyonu. 131 şablon birbirinden renk, görsel ve içerikle ayrışır ama düzen aileleri tekrar eder. Gerçekten farklı düzenler isterseniz önce PSD/XD önizlemelerine bakıp elle tasarım gerekir.
3. Örnek metinler genel taslaktır (ör. tarih/yer/fiyat uydurmadır); yayından önce değiştirin. Sabit tarih "14 Kasım" ve kod "HOSGELDIN" örnektir.
4. `ZIP`'ler `images/` klasör girdisi içerir (girdi sayısı = görsel + 2).
5. Yinelenen kaynak: `corporate-newsletter-template-…-07-14-56-utc (1).zip` aynı adın kopyası; ikisi de ayrı şablon üretti.
6. Chrome'un headless penceresi 500 px altına inmediği için mobil görüntü 375 px'lik iframe içinde render edildi (medya sorgusu gerçekçi çalışır). Gerçek istemci (Gmail/Outlook) testi yapılmadı.

## Tablo
| No | Kaynak ZIP | Ad | Kategori | Düzen | Mod | Kaynak durumu | Lisans riski |
|---|---|---|---|---|---|---|---|
| 001 | ai-email-newsletter-email-template-2024-05-16-21-19-28-utc.zip | Kıyı Teknoloji Güncellemesi | startup | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 002 | airways-email-newsletter-2023-11-27-05-16-02-utc.zip | Çınar Seyahat Kampanyası | marketing | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 003 | architechture-email-newsletter-2023-11-27-04-50-22-utc.zip | Fener Teknoloji Güncellemesi | startup | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 004 | automotive-email-newsletter-2023-11-27-04-58-18-utc.zip | Ceviz Otomotiv Lansmanı | product_launch | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 005 | automotive-newsletter-template-2026-09-02-17-34-54-utc.zip | Mavi Otomotiv Lansmanı | product_launch | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 006 | beauty-skincare-email-newsletter-template-2023-11-27-05-30-08-utc.zip | Nar Güzellik Mağaza Bülteni | ecommerce | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 007 | beefatox-email-newsletter-2023-11-27-05-21-44-utc.zip | Çam Teknoloji Duyurusu | announcement | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 008 | black-email-newsletter-template-2026-09-02-08-17-19-utc.zip | Kıvılcım İnsan kaynakları Kariyer Bülteni | recruitment | Pozisyon listesi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 009 | business-email-newsletter-2023-11-27-04-55-13-utc.zip | İnci Kurumsal Karşılaması | welcome | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 010 | business-email-newsletter-2026-09-01-14-30-18-utc.zip | Selvi Aksesuar Duyurusu | announcement | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 011 | business-email-newsletter-2026-09-01-14-33-21-utc.zip | Cevher İnsan kaynakları Kariyer Bülteni | recruitment | Pozisyon listesi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 012 | business-email-newsletter-landing-page-template-2026-09-02-13-23-23-utc.zip | Kar Kurumsal Karşılaması | welcome | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 013 | business-email-newsletter-layout-template-2026-09-02-07-12-56-utc.zip | Sahil Emlak Duyurusu | announcement | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 014 | business-email-newsletter-template-2023-11-27-04-54-56-utc.zip | Berrak İnsan kaynakları Kariyer Bülteni | recruitment | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 015 | business-email-newsletter-template-2026-09-02-06-32-42-utc.zip | Işık Kurumsal Karşılaması | welcome | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 016 | business-email-newsletter-template-2026-09-02-08-18-20-utc.zip | Patika Dekorasyon Duyurusu | announcement | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 017 | business-email-newsletter-template-2026-09-02-10-44-53-utc.zip | Zeybek İnsan kaynakları Kariyer Bülteni | recruitment | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 018 | business-email-template-2026-09-01-16-53-23-utc.zip | Gamze Kurumsal Karşılaması | welcome | Hikâye | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 019 | business-email-template-2026-09-01-19-50-36-utc.zip | Özgün Dijital güvenlik Duyurusu | announcement | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 020 | business-newsletter-template-2026-09-02-02-58-19-utc.zip | Lale İnsan kaynakları Kariyer Bülteni | recruitment | Pozisyon listesi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 021 | business-newsletter-template-2026-09-02-09-07-38-utc.zip | Limon Kurumsal Karşılaması | welcome | Hikâye | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 022 | bussiness-issue-newsletter-2023-11-27-05-05-00-utc.zip | Şafak Yardım derneği Duyurusu | announcement | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 023 | charity-email-newsletter-2025-04-14-22-09-29-utc.zip | Sedir Yardım derneği Duyurusu | announcement | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 024 | clean-email-newsletter-template-2026-09-01-19-22-24-utc.zip | Menekşe Müzik ve sinema Mağaza Bülteni | ecommerce | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 025 | clean-multi-panel-email-newsletter-template-2026-09-02-13-10-18-utc.zip | Zümrüt Sigorta Raporu | investor | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 026 | company-newsletter-template-2026-09-02-02-42-14-utc.zip | Gökyüzü Müzik ve sinema Daveti | event | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 027 | company-newsletter-template-2026-09-02-03-15-27-utc.zip | Hilal Konaklama Mağaza Bülteni | ecommerce | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 028 | compbrand-newsletter-template-2023-11-27-05-01-23-utc.zip | Palmiye Sigorta Raporu | investor | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 029 | corporate-email-newsletter-2026-09-01-16-32-18-utc.zip | Bozkır Müzik ve sinema Daveti | event | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 030 | corporate-email-newsletter-2026-09-01-21-15-08-utc.zip | Irmak Outdoor Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 031 | corporate-email-newsletter-template-2026-09-02-18-04-06-utc.zip | Rota Sigorta Raporu | investor | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 032 | corporate-newsletter-email-template-2026-09-02-05-44-22-utc.zip | Akşam Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 033 | corporate-newsletter-template-2026-09-02-02-57-19-utc.zip | Hazine Restoran Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 034 | corporate-newsletter-template-2026-09-02-07-14-56-utc (1).zip | Orta Sigorta Raporu | investor | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 035 | corporate-newsletter-template-2026-09-02-07-14-56-utc.zip | Yasemin Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 036 | countnews-newsletter-template-2023-11-27-05-34-49-utc.zip | Fidan İnsan kaynakları Kariyer Bülteni | recruitment | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 037 | destinate-newsletter-2023-11-27-05-22-20-utc.zip | Nazlı Seyahat Kampanyası | marketing | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 038 | destination-newsletter-2023-11-27-05-16-06-utc.zip | Pusula Seyahat Kampanyası | marketing | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 039 | educa-newsletter-template-2023-11-27-04-50-20-utc.zip | Nehir Eğitim Duyurusu | announcement | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 040 | email-newsletter-2023-11-27-04-54-21-utc.zip | Vadi Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 041 | email-newsletter-2023-11-27-05-01-28-utc.zip | Toprak Kurumsal Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 042 | email-newsletter-2023-11-27-05-13-03-utc.zip | Liman Sigorta Raporu | investor | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 043 | email-newsletter-2023-11-27-05-13-27-utc.zip | Sümbül Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 044 | email-newsletter-athena-2023-11-27-04-50-32-utc.zip | Dağ Kurumsal Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 045 | email-newsletter-foxes-2023-11-27-05-06-25-utc.zip | Gül Sigorta Raporu | investor | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 046 | email-newsletter-foxes-2023-11-27-05-09-06-utc.zip | Okyanus Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 047 | email-newsletter-foxes-2023-11-27-05-09-16-utc.zip | Alize Kurumsal Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 048 | email-newsletter-foxes-2023-11-27-05-12-43-utc.zip | Hasat Sigorta Raporu | investor | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 049 | email-newsletter-foxes-2023-11-27-05-31-51-utc.zip | Pınar Müzik ve sinema Daveti | event | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 050 | email-newsletter-noah-2023-11-27-04-57-13-utc.zip | Zirve Kurumsal Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 051 | email-newsletter-noah-2023-11-27-05-03-40-utc.zip | Gece Sigorta Raporu | investor | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 052 | email-newsletter-notice-2023-11-27-05-02-14-utc.zip | Neşe Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 053 | email-newsletter-template-2023-11-27-04-49-23-utc.zip | Vaha Kurumsal Mağaza Bülteni | ecommerce | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 054 | email-newsletter-template-2023-11-27-04-51-41-utc.zip | Engin Sigorta Raporu | investor | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 055 | email-newsletter-template-2023-11-27-04-54-21-utc.zip | Mor Müzik ve sinema Daveti | event | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 056 | email-newsletter-template-2023-11-27-05-13-46-utc.zip | Zeytin Kurumsal Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 057 | email-newsletter-template-2023-11-27-05-18-03-utc.zip | Kayın Sigorta Raporu | investor | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 058 | email-newsletter-template-2023-11-27-05-20-10-utc.zip | Kumsal Müzik ve sinema Daveti | event | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 059 | email-newsletter-template-2023-11-27-05-29-49-utc.zip | Yıldız Kurumsal Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 060 | email-newsletter-template-2023-11-27-05-30-07-utc.zip | Köprü Sigorta Raporu | investor | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 061 | email-newsletter-template-2023-11-27-05-31-30-utc.zip | Kiraz Müzik ve sinema Daveti | event | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 062 | email-newsletter-template-2023-11-27-05-32-03-utc.zip | Gün Batımı Kurumsal Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 063 | email-newsletter-template-2023-11-27-05-32-20-utc.zip | Fırtına Sigorta Raporu | investor | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 064 | email-newsletter-template-2023-11-27-05-32-35-utc.zip | Nilüfer Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 065 | email-newsletter-template-2023-11-27-05-35-29-utc.zip | Zambak Kurumsal Mağaza Bülteni | ecommerce | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 066 | email-newsletter-template-2026-09-01-21-36-15-utc.zip | Gökçe Sigorta Raporu | investor | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 067 | email-newsletter-template-2026-09-02-10-21-32-utc.zip | Orkide Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 068 | email-template-2026-09-02-03-05-22-utc.zip | Yaprak Kurumsal Mağaza Bülteni | ecommerce | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 069 | email-template-2026-09-02-03-06-22-utc.zip | Feneri Sigorta Raporu | investor | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 070 | email-template-2026-09-02-05-03-07-utc.zip | Mısra Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 071 | eyewear-newsletter-template-2023-11-27-04-51-36-utc.zip | Uyum Aksesuar Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 072 | fashiobrand-newsletter-2023-11-27-05-18-32-utc.zip | Dingin Moda Mağaza Bülteni | ecommerce | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 073 | fashion-email-newsletter-2026-09-01-14-33-22-utc.zip | Lacivert Moda Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 074 | fashion-email-newsletter-template-2026-09-01-14-34-21-utc.zip | Mercan Moda Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 075 | fashion-email-newsletter-template-2026-09-01-15-57-00-utc.zip | Dere Moda Mağaza Bülteni | ecommerce | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 076 | fashione-newsletter-2023-11-27-05-04-14-utc.zip | Yonca Moda Mağaza Bülteni | ecommerce | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 077 | fashion-newsletter-2023-11-27-05-30-48-utc.zip | Meltem Moda Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 078 | fitnesa-email-newsletter-2023-11-27-05-20-53-utc.zip | Demet Spor salonu Duyurusu | announcement | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 079 | furnita-email-newsletter-2023-11-27-05-23-49-utc.zip | Badem Dekorasyon Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 080 | furnitema-email-newsletter-2023-11-27-04-50-50-utc.zip | Akçaağaç Dekorasyon Mağaza Bülteni | ecommerce | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 081 | furniture-email-newsletter-template-2026-09-02-10-50-56-utc.zip | Elma Dekorasyon Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 082 | gold-email-newsletter-template-2026-09-02-07-14-56-utc.zip | Maviş Aksesuar Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 083 | gym-email-newsletter-2025-04-24-02-25-01-utc.zip | Yelken Spor salonu Duyurusu | announcement | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 084 | gymnest-email-newsletter-2023-11-27-05-09-14-utc.zip | Filiz Spor salonu Duyurusu | announcement | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 085 | hair-salon-email-newsletter-2023-11-27-05-03-05-utc.zip | Nisan Kuaför salonu Müşteri Notları | customer | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 086 | hair-salon-email-newsletter-2023-11-27-05-20-11-utc.zip | Vitrin Kuaför salonu Müşteri Notları | customer | Hikâye | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 087 | high-quality-a4-flyer-mockup-2026-01-21-09-13-49-utc.zip | Esinti Outdoor Lansmanı | product_launch | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 088 | hilmusic-email-newsletter-2023-11-27-04-54-56-utc.zip | Lodos Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 089 | hotel-email-newsletter-template-2026-09-01-18-44-08-utc.zip | Tül Konaklama Kampanyası | marketing | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 090 | insurance-tick-email-newsletter-2023-11-27-05-07-18-utc.zip | Cömert Sigorta Raporu | investor | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 091 | marketing-email-newsletter-2026-09-01-20-31-51-utc.zip | Kuş Sigorta Raporu | investor | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 092 | medicalerg-email-newsletter-2023-11-27-05-30-53-utc.zip | Ardıç Sağlık Müşteri Notları | customer | Hikâye | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 093 | medical-newsletter-template-2023-11-27-04-55-43-utc.zip | Rüzgâr Sağlık Müşteri Notları | customer | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 094 | modern-geometric-email-newsletter-2024-06-11-02-39-14-utc.zip | Ay Sağlık Lansmanı | product_launch | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 095 | modern-newsletter-template-2026-09-02-13-23-23-utc.zip | Çiçek Yardım derneği Bülteni | newsletter | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 096 | movie-channel-email-newsletter-2023-11-27-04-55-44-utc.zip | Ova Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 097 | newsletter-business-email-2026-09-01-18-20-59-utc.zip | Akasya İnsan kaynakları Kariyer Bülteni | recruitment | Pozisyon listesi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 098 | newsletter-email-template-2026-09-02-04-14-48-utc.zip | İpek Kurumsal Karşılaması | welcome | Hikâye | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 099 | newsletter-email-template-2026-09-02-04-24-53-utc.zip | Barış Güzellik Duyurusu | announcement | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 100 | newsletter-email-template-2026-09-02-07-03-52-utc.zip | Lavanta İnsan kaynakları Kariyer Bülteni | recruitment | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 101 | newsletter-email-template-2026-09-02-07-10-55-utc.zip | Umut Kurumsal Karşılaması | welcome | Hikâye | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 102 | newsletter-layout-template-2024-02-13-17-01-59-utc.zip | Eylül Kuaför salonu Duyurusu | announcement | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 103 | newsletter-template-2026-04-03-03-43-04-utc.zip | Meşe İnsan kaynakları Kariyer Bülteni | recruitment | Pozisyon listesi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 104 | newsletter-template-2026-09-02-05-04-08-utc.zip | Uçurtma Kurumsal Karşılaması | welcome | Hikâye | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 105 | nimavpn-email-newsletter-2023-11-27-05-36-57-utc.zip | Damla Dijital güvenlik Lansmanı | product_launch | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 106 | orange-newsletter-template-2026-09-02-06-53-49-utc.zip | Kelebek Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 107 | phase-multipurpose-e-newsletter-template-2023-11-27-05-35-37-utc.zip | Sis Kurumsal Mağaza Bülteni | ecommerce | Kart ızgarası | A | ZIP'te yalnızca yardım sayfası | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 108 | photomind-email-newsletter-2023-11-27-05-17-31-utc.zip | Bilge Fotoğraf stüdyosu Bülteni | newsletter | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 109 | poltunes-email-newsletter-2023-11-27-05-05-03-utc.zip | İlkbahar Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 110 | portfolio-email-newsletter-2023-11-27-05-25-50-utc.zip | Bahar Fotoğraf stüdyosu Bülteni | newsletter | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 111 | promotional-email-newsletter-template-2026-09-02-10-01-25-utc.zip | Güneş İnsan kaynakları Kariyer Bülteni | recruitment | Pozisyon listesi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 112 | real-estate-email-newsletter-template-2026-09-02-12-52-11-utc.zip | Orman Emlak Kampanyası | marketing | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 113 | render-newsletter-template-2023-11-27-05-01-52-utc.zip | Bulut Sigorta Raporu | investor | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 114 | responsive-email-newsletter-template-2026-09-02-12-03-53-utc.zip | Kehribar Müzik ve sinema Daveti | event | Etkinlik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 115 | resume-email-newsletter-2023-11-27-05-13-42-utc.zip | Defne Fotoğraf stüdyosu Bülteni | newsletter | Hikâye | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 116 | school-newsletter-template-2025-02-04-23-27-31-utc.zip | Papatya Eğitim Duyurusu | announcement | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 117 | shoppingbrand-newsletter-template-2023-11-27-05-26-58-utc.zip | Gelincik Moda Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 118 | simply-elegant-pink-email-newsletter-2023-11-27-05-31-08-utc.zip | Kuzey Güzellik Mağaza Bülteni | ecommerce | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 119 | skincarels-email-newsletter-2024-06-11-02-37-11-utc.zip | Tomurcuk Güzellik Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 120 | special-foodie-email-newsletter-2023-11-27-04-50-12-utc.zip | Düş Restoran Bülteni | newsletter | Dergi | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 121 | sportronde-email-newsletter-2023-11-27-04-49-20-utc.zip | Leylak Spor salonu Duyurusu | announcement | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 122 | sports-product-newsletter-template-2026-09-02-07-24-00-utc.zip | Tepe Outdoor Lansmanı | product_launch | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 123 | starsup-medical-email-newsletter-2023-11-27-05-21-37-utc.zip | Coşku Sağlık Müşteri Notları | customer | Hikâye | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 124 | tconnection-newsletter-template-2023-11-27-05-31-57-utc.zip | Jeton Emlak Haberleri | corporate | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 125 | team-email-newsletter-template-2026-09-01-20-52-59-utc.zip | Rüya İnsan kaynakları Kariyer Bülteni | recruitment | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 126 | tech-email-newsletter-template-2026-09-01-20-17-46-utc.zip | Aydınlık Teknoloji Güncellemesi | startup | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 127 | tech-product-newsletter-template-2026-09-02-16-53-39-utc.zip | Hüzün Teknoloji Güncellemesi | startup | Duyuru/istatistik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 128 | travel-email-newsletter-template-2026-09-01-21-08-05-utc.zip | Kıyı Seyahat Kampanyası | marketing | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 129 | watch-email-newsletter-2023-11-27-05-12-16-utc.zip | Çınar Aksesuar Mağaza Bülteni | ecommerce | Ürün vitrini | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (hiç lisans/doküman yok); çıktı: düşük |
| 130 | webinar-email-newsletter-template-2023-11-27-04-52-27-utc.zip | Fener Çevrimiçi etkinlik Daveti | event | Klasik | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
| 131 | white-email-newsletter-template-2026-09-02-18-03-06-utc.zip | Ceviz İnsan kaynakları Kariyer Bülteni | recruitment | Kart ızgarası | A | HTML yok (PSD/XD/Fig) | kaynak: bilinmiyor (lisans metni yok, yalnızca not/PDF); çıktı: düşük |
