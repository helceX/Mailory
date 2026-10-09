# Şablon paketleri (içe aktarma için hazır)

131 özgün (MOD A) e-posta şablonu. Her klasör: `<slug>.zip` (index.html + images/) ve `sablon.json` (ad, kategori, açıklama).
`manifest.json` hepsini listeler. Paketler `docs/MAILORY_ENVATO_BRIEF.md` kurallarına göre üretildi ve doğrulandı
(`_rapor/dogrulama.csv`).

- Kaynak Envato ZIP'lerinde HTML yoktu; yalnızca ad/sektör ipucu kullanıldı, hiçbir metin/görsel/kod kopyalanmadı.
- Kaynak lisansı BİLİNMİYOR (`_rapor/lisans.md`); ayrıntılar `_rapor/OZET.md`.
- İçe aktarma: Şablonlar → İçe aktar (ZIP), ya da `importTemplate` servisi (`apps/web/src/lib/templates/import.ts`) ile toplu.
  Ad/kategori için `sablon.json` kullanılır; kategori değerleri `LibraryTemplate["category"]` ile aynıdır.

## Toplu içe aktarma (betik)

```bash
# Ortam değişkeni: bağlantı dizesi yalnızca DATABASE_URL'den okunur (koda/bayrağa yazılmaz)
export DATABASE_URL="postgres://…"

pnpm templates:import --org <organizasyon-uuid> --dry-run                       # hiçbir şey yazmaz
pnpm templates:import --org <organizasyon-uuid> --only akasya-insan-kaynaklari-kariyer-bulteni,aksam-muzik-ve-sinema-daveti
pnpm templates:import --org <organizasyon-uuid>                                  # tümü
```

- Mevcut `importHtmlTemplateFor` hattını kullanır; şablonlar organizasyonun **sahibi** (owner) adına oluşur ve `template.imported` olarak denetim kaydına düşer.
- **Idempotent**: aynı adlı canlı şablon atlanır; yeniden çalıştırmak güvenlidir.
- **Görsel kapasitesi**: bir organizasyon en fazla 200 görsel (`MAX_ASSETS_PER_ORG`) tutabilir; paketlerin toplamı 383 görseldir. Betik, sığmayan paketi **eksik görselle yüklemez**; atlayıp "image capacity" olarak raporlar ve çıkış kodu 1 verir. Tümünü tek organizasyona yüklemek için sınırın yükseltilmesi gerekir (bkz. `docs/MAILORY_OPEN_ITEMS.md` B15).
- `aciklama` alanı bilgilendiricidir; şablon tablosunda açıklama sütunu olmadığından saklanmaz.
