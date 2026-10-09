# Şablon paketleri (içe aktarma için hazır)

131 özgün (MOD A) e-posta şablonu. Her klasör: `<slug>.zip` (index.html + images/) ve `sablon.json` (ad, kategori, açıklama).
`manifest.json` hepsini listeler. Paketler `docs/MAILORY_ENVATO_BRIEF.md` kurallarına göre üretildi ve doğrulandı
(`_rapor/dogrulama.csv`).

- Kaynak Envato ZIP'lerinde HTML yoktu; yalnızca ad/sektör ipucu kullanıldı, hiçbir metin/görsel/kod kopyalanmadı.
- Kaynak lisansı BİLİNMİYOR (`_rapor/lisans.md`); ayrıntılar `_rapor/OZET.md`.
- İçe aktarma: Şablonlar → İçe aktar (ZIP), ya da `importTemplate` servisi (`apps/web/src/lib/templates/import.ts`) ile toplu.
  Ad/kategori için `sablon.json` kullanılır; kategori değerleri `LibraryTemplate["category"]` ile aynıdır.
