# MAILORY — BTM pilot kılavuzu

Amaç: BTM'nin (ve sponsor olduğu girişimcilerin) SendPulse'tan Mailory'ye **riski düşük, geri dönülebilir** biçimde geçişi. Mailory'nin hiçbir adımı SendPulse'ı kapatmaz; ikisi bir süre paralel yaşar.

## 1. Pilot öncesi (BTM + platform yöneticisi)

- [ ] Prod ortamı hazır ve `/api/health/ready` yeşil (bkz. `MAILORY_RUNBOOK.md`).
- [ ] SES üretim erişimi onaylı (sandbox dışı); DNS: gönderici alan adı için DKIM + sahiplik TXT + SPF/DMARC.
- [ ] Platform yöneticisi `/platform`'dan **BTM partner kurumunu** oluşturdu; BTM yetkilisi daveti kabul etti.
- [ ] Hukuki metinler hazır: aydınlatma metni, gizlilik politikası, veri işleme sözleşmesi (OPEN_ITEMS A11).
- [ ] BTM'nin gönderici alan adı Mailory'de **Doğrulandı** durumunda; Deliverability Merkezi'nde kritik bulgu yok.

## 2. Veri geçişi (SendPulse → Mailory)

Sıra önemlidir: **önce engeller, sonra kişiler.**

1. **SendPulse'tan dışa aktar:** adres defteri(ler)i CSV olarak; ayrıca abonelikten çıkanlar, sert bounce olanlar ve şikayet edenler listesi.
2. **Bastırma listesini ilk yükle** (Kitle → Bastırma listesi): abonelikten çıkanları sebep = _Abonelikten çıktı_, sert bounce'ları _Sert bounce_, şikayetleri _Şikayet_ seçerek yapıştır (1000'erli gruplar). Böylece sonraki içe aktarma bu adreslere asla e-posta göndermez.
3. **Kişileri içe aktar** (Kitle → İçe aktar): CSV'yi yükle; `Email`, `Name`, `Phone` ve şirket/şehir sütunları otomatik eşlenir. Eşlemeyi kontrol et, **Kaynak** olarak "sendpulse_migration" gibi tutarlı bir ad gir. Önizlemedeki hatalı/yinelenen/bastırılmış sayılarını incele.
4. **İzin (consent) kontrolü:** yalnızca daha önce bu kurumdan e-posta almayı kabul etmiş kişileri içe aktarın. İzni belgelenemeyen adresler (satın alınmış/toplanmış listeler) **aktarılmaz**. İçe aktarma ekranındaki izin beyanı kayda geçer (denetim kaydı).
5. **Etiket/liste:** SendPulse adres defterlerini Mailory listelerine, segment mantığını (ör. "girişimci", "mentor") etiketlere çevir.
6. **Doğrula:** toplam kişi sayısı = SendPulse sayısı − bastırılanlar − hatalılar; 10 rastgele kişiyi elle karşılaştır.

## 3. Isınma ve ilk gönderimler

SES hesabı ve alan adı yeni olduğundan hacim kademeli artırılır (günlük gönderim sınırı varsayılan 2000, platform yöneticisi yükseltir):

| Gün  | Hedef                             | Kural                                                      |
| ---- | --------------------------------- | ---------------------------------------------------------- |
| 1–2  | ≤ 500, en etkileşimli kişiler     | Etkileşim skoru yüksek segment                             |
| 3–5  | ≤ 2000                            | Bounce < %2, şikayet < %0,1 değilse **dur**                |
| 6–14 | Her gün ~2×, hedef liste boyutuna | Deliverability Merkezi'ni her gönderimden sonra kontrol et |

Her ilk kampanyadan önce: test gönderimi (kendi adresin), Hazırlık denetimi tüm maddeler yeşil, abonelikten çık bağlantısı çalışıyor.

## 4. Girişimci (sponsorlu) onboarding

1. BTM yetkilisi `/partner` → "Girişimci ekle" (ad + e-posta); girişimci davet e-postasıyla **sahip** olarak katılır.
2. BTM plan/limitleri belirler (en çok pro plan değerleri); içerik/kişi verilerini **göremez** (yalnızca durum ve sayaçlar).
3. Şablon Merkezi'nden BTM'nin yayınladığı şablonlar girişimciye açılır.
4. Girişimci ilk 3 adımı tamamlar: alan adı doğrulama → ilk liste → ilk test gönderimi (partner panelinde "ilk gönderim yapıldı" görünür).

## 5. Başarı ölçütleri (2 hafta)

- Teslim edilebilirlik: bounce < %2, şikayet < %0,1, otomatik duraklatma tetiklenmedi.
- Aktif kullanım: BTM en az 3 kampanya gönderdi; ≥ 3 girişimci ilk gönderimini yaptı.
- Destek: kritik hata yok; ortalama destek yanıtı < 1 iş günü.
- Geri bildirim: BTM ile haftalık 30 dk gözden geçirme; talepler `MAILORY_TASKS.md`'ye işlenir.

## 6. Geri dönüş planı

SendPulse hesabı pilot sonuna dek **açık** kalır. Sorun halinde: Mailory'de kampanyaları duraklat (veya platformdan çalışma alanını askıya al) ve gönderimi SendPulse'a devret. Mailory'de abonelikten çıkan/bounce olan adresleri SendPulse'a da bastırma olarak aktar (şimdilik bastırma listesinden adresler kopyalanır; toplu dışa aktarma ekranı yok — OPEN_ITEMS C8).

## 7. Pilot sonrası

Kalibrasyon: Deliverability eşikleri ve etkileşim skoru (OPEN_ITEMS B3/B4) gerçek verilerle gözden geçirilir; plan limitleri (A9) fiyat kararına bağlanır.
