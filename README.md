# WhatsApp Çevirmen (Chrome uzantısı)

web.whatsapp.com'da:
- **Gelen mesaj:** Türkçe olmayan mesajın altında **🌐 Çevir** bağlantısı; tıklayınca çeviri mesajın içinde, orijinalin altında görünür. *Otomatik çevir* açıksa son ~15 mesaj kendiliğinden çevrilir.
- **Giden mesaj:** Türkçe yaz → Enter (ya da Gönder) → **önizleme**: çeviriyi düzenle → Enter ile karşı tarafın diliyle gider. Karşı tarafın dili o sohbette gelen mesajlardan öğrenilir ya da listeden seçersin.
- Sohbetin sağ üstündeki **🌐 Çeviri: AÇIK/KAPALI** düğmesi sohbet bazlı; ⚙ ile hedef dil, otomatik çeviri, giden çeviri, giden dil ve *WhatsApp'ta Enter gönderiyor* ayarı.
- WhatsApp'ta "Enter = yeni satır" seçiliyse ayarlardaki ilgili kutuyu kapat: önizleme o zaman **Ctrl+Enter** ile açılır.

## Kurulum
1. `chrome://extensions` → Geliştirici modu → **Paketlenmemiş öğe yükle** → bu klasör.
2. Açılan ayar sayfasında dil ve AI modelini (URL, API anahtarı, model adı) gir → *Test et* → *Kaydet*. (Varsayılan: yerel 9router; **API anahtarını kendin girmelisin** — kodda gömülü anahtar yok.)
3. WhatsApp Web sekmesini **F5** ile yenile.

Gereken Chrome sürümü: **138+** (Chrome dahili çeviri API'si için). Yalnızca AI motoru kullanılacaksa daha eski sürümler de çalışır.

## Motor
AI modeli (OpenAI uyumlu; sırayla ana + yedekler) → olmazsa Chrome dahili çeviri (Translator API; yalnızca o metin; Farsça gibi bazı diller desteklenmeyebilir). Ayarlardan tek motora kilitlenebilir. Mesaj metni yalnızca seçtiğin AI adreslerine gider.

## Dosyalar
`manifest.json` · `wa-translate.js` (sayfadaki arayüz) · `background.js` + `translate-bg.js` (AI çağrısı, yedek yazma/Enter) · `options.*` (ayarlar)

## Bilinen sınırlar
Gerçek WhatsApp Web'de metin yerleştirme ve mesaj bulma WhatsApp'ın sayfa yapısına bağlıdır; güncellemeyle bozulabilir (⚙ panelinin altındaki "Teşhis" satırı neyin bulunduğunu gösterir). Yedek yol Chrome'un "hata ayıklama" şeridini kısa süre gösterebilir.

## Gizlilik
Uzantının kendi sunucusu yok. Mesaj metni yalnızca ayarlarda girdiğin AI adreslerine gider; Chrome dahili çeviri motoru seçiliyse metin cihazdan çıkmaz. Hiçbir analitik/izleme yok.

## Katkı
Hata bildirimi ve öneriler için Issue açabilirsin. Kod tek dosyalık içerik betiği + arka plan betiği şeklinde; `package.json`/derleme adımı yok, değişiklikten sonra `chrome://extensions` → ↻ ile yeniden yükle.

## Lisans
MIT — bkz. [LICENSE](LICENSE).
