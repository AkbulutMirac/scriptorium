# Scriptorium — Plan

**Durum:** Tüm aşamalar tamam ve DeepSeek bağlı (2026-11-07). Kalan: Ollama kurulumu (local işçi). Başlatma: masaüstündeki Scriptorium kısayolu (scripts\Scriptorium.bat).
**Ad:** Scriptorium. Ortaçağ manastırlarında yazıcıların masalarında el yazması kopyaladığı oda. Claude baş yazıcı, işçiler yazıcılar. (Eski çalışma adı: isci-mcp)
**Geri dönünce:** Claude'a "Scriptorium planına devam" de.
**Arayüz kararı:** Kendi arayüzümüz, HeroUI ile (aşağıda, "Arayüz tasarımı" bölümünde).

## Hedef

Tek bir web arayüzü:
- **Sohbet paneli:** Claude'la (patron) ya da herhangi bir işçiyle doğrudan mesajlaşma
- **3D kütüphane:** Hangi işçinin ne yaptığı, kimin boşta oturduğu canlı olarak görünür
- **İşçi ekleme:** Arayüzden yeni işçi eklenir, Claude da onu anında kullanabilir

Claude işi kime vereceğine kendisi karar verir.

```
              Tarayıcı (React)
   ┌────────────────────┬──────────────────────┐
   │ Sohbet paneli      │ 3D kütüphane         │
   │ (ajan seç, yaz)    │ (kim ne yapıyor)     │
   │ + Terminal sekmesi │                      │
   └─────────┬──────────┴──────────▲───────────┘
             │ WebSocket           │ işçi olayları
   ┌─────────▼─────────────────────┴────────────┐
   │ Arka uç (Node / TypeScript + Agent SDK)    │
   │  - Claude Code → Claude (patron)           │
   │  - DeepSeek API sohbeti (işçi)             │
   │  - Ollama sohbeti (local modeller)         │
   │  - işçi araçları (SDK MCP) + agents.json   │
   └─────────┬──────────────────────────────────┘
             ▼
   Kurulu claude CLI · DeepSeek API · Ollama
```

## Alınan kararlar

- **Claude bağlantısı:** Arkada çalışan gerçek Claude Code'a bağlanılır.
  - Claude Agent SDK (TypeScript) zaten Claude Code'u alt süreç olarak çalıştırıyor.
  - `pathToClaudeCodeExecutable` seçeneği bilgisayarda kurulu `claude` CLI'ı gösterir. CLI kendi kendini güncellediği için yeni modeller, araçlar ve özellikler kendiliğinden gelir.
  - `settingSources` varsayılan ayarda kalır. Böylece CLAUDE.md, MCP sunucuları, skill'ler ve plugin'ler terminaldekiyle aynı olur.
  - Oturumlar aynı klasörde tutulur, terminalden de devam ettirilebilir (doğrulanacak).
  - SDK'nın kendi güncellemesi tek komut: `npm update`. SDK ile CLI sürümleri birbirinden çok uzaklaşırsa uyumsuzluk çıkabilir.
- **Abonelik:** Kişisel kullanımda Claude aboneliğiyle giriş yapılabiliyor. Anthropic planladığı değişikliği durdurdu, kullanım abonelik limitinden düşüyor. Bu politika değişebilir, başlarken support.claude.com'daki "Use the Claude Agent SDK with your Claude plan" makalesini tekrar kontrol et. Yedek plan: Console API anahtarı.
- **Güncellemelere dayanıklı arayüz:** Arayüzün tanımadığı mesaj türleri genel bir kart olarak gösterilir, hiçbir şey bozulmaz, sonradan güzelleştirilir. Opsiyonel olarak bir "Terminal" sekmesi (xterm.js) eklenir: sohbet panelinin henüz desteklemediği her özellik orada gerçek Claude Code ekranıyla kullanılır.
- **Tek dil:** Arka uç ve işçi araçları TypeScript ile yazılır. İşçi araçları SDK'nın kendi içindeki MCP sunucusu olur, böylece olaylar doğrudan arayüze akar.
- **Her ajan ayrı:** Claude Code üzerinden sadece Claude çalışır. DeepSeek ve local modeller Claude Code'dan bağımsızdır.
  - Arayüzdeki ajan seçiciden herhangi biriyle doğrudan sohbet edilir. Her ajanın kendi sohbet geçmişi olur.
  - Claude da onlara işçi araçları üzerinden iş verir.
- **DeepSeek bağlantısı:** Doğrudan DeepSeek API'si (OpenAI uyumlu). Ollama da aynı formatı kullandığı için ikisi tek bir istemciyle konuşur. Modeller: `deepseek-flash` (V4.1-Flash, ucuz) ve `deepseek-v4-pro` (güçlü).
- **Kod akışı:**
  1. Claude görevi ve testleri yazar.
  2. İşçi aracı ilgili dosyaları okuyup DeepSeek'e gönderir, gelen kodu ayrı bir git worktree'ye yazar.
  3. Testler otomatik çalışır.
  4. Claude yalnızca diff'e ve sonuca bakar.
- **Local işçiler (Ollama, ücretsiz):**
  - `qwen3.8-27b-metin`: `hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ2_S` (9.3 GB) modelinin görsel modülü çıkarılmış kopyası. Bağlam 16K. Ölçülen (RTX 4060 Laptop, %41 CPU / %59 GPU): çıktı ~3,7 token/sn, girdi ~250 token/sn, ilk yükleme ~15 sn. Düşünme kapalı çalışır (açıkken dakikalar sürer).
  - Küçük bir embedding modeli: arama ve RAG için
- **Local işçilerin rolü:**
  - TÜBİTAK YOLO projesi için görsel ön eleme (gece çalışan toplu iş)
  - Gizli veri
  - Deadlock wiki için arama indeksi (embedding)
  - Acelesi olmayan toplu işler (bot loglarını özetlemek vb.)
  - Kod yazımı local'e değil DeepSeek'e gider.
- **Kural: Uzun işler arka planda çalışır.** Claude işi başlatır, bir iş numarası alır, sonucu sonra kontrol eder. Böylece kilitlenip beklemez.
- **Kural: Gizlilik.** "hassas" diye işaretlenen dosya ve işler sadece local işçiye gider. DeepSeek'e giden veri Çin'deki sunuculara gidiyor.
- **İşçi listesi:** `agents.json`. Claude'un araçları: `list_workers`, `ask_worker(isim, görev, dosyalar)`, `start_job` ve `job_status` (arka plan işleri için).
- **Dosyalar:** Dosyaları Claude değil araç kendisi okur, böylece Claude token harcamaz.
- **Para güvenliği:** DeepSeek ön ödemeli, bakiye bitince `402` hatası verip durur. Ödeme limitli sanal kartla yapılır. Araçta çağrı başına `max_tokens` limiti olur.

## Arayüz tasarımı (karar: 2026-11-07)

**Teknoloji:** React + HeroUI + react-three-fiber (3D).
- Sohbet bileşenleri HeroUI ile kendimiz yazılır. Gerekirse assistant-ui'ın başsız (headless) parçaları kullanılır.
- Claude oturumlarının nasıl yönetildiğini görmek için CloudCLI'ın (siteboon/claudecodeui) koduna referans olarak bakılır.

**Yerleşim (3 sütun, hedef ekran 1920x1080, %100 ölçek):**

```
┌──────────┬──────────────────────────────┬──────────────┐
│ Geçmiş   │        3D kütüphane          │ Sohbet       │
│ (seçili  │  Claude ortada, işçiler      │ (seçili      │
│  ajanın) │  etrafta, "+ işçi" butonu    │  ajanla)     │
└──────────┴──────────────────────────────┴──────────────┘
   ~280px            kalan alan               ~520px
```

- **Sohbet paneli boyutlandırılabilir.** Kenarından sürüklenir, genişliği hatırlanır.
- **Geçmiş paneli daraltılabilir (odak modu).** Sadece ikonlar kalır, sohbet genişler.
- **Uzun içerik ortada açılır.** Diff ve dosya gibi geniş içerikler 3D sahnenin üstünde açılır, çünkü 80-100 karakterlik kod satırları ~520px'lik sohbete sığmaz.
- **3D sahnede bir karaktere tıklamak o ajanı seçer.** Sohbet ve geçmiş o ajana geçer.

**Claude paneli, Claude desktop uygulamasının Code sekmesi gibi çalışır:**
- **Yan sohbet (side chat):** Ana sohbeti bozmadan bir mesaj hakkında ayrı konuşma açılır. Sohbetin bağlamını bilir ama ana sohbete karışmaz. Teknik olarak SDK'daki `resume` + `forkSession` ile yapılır.
  - Yan sohbet, ana sohbetin sağında ek bir sütun olarak açılır. 3D sahne o sırada daralır.
- **Mesaja yanıt verme:** Bir mesajın tamamı ya da seçili bir kısmı alıntılanarak soru sorulur.
- **Renk temaları:** Açık ve koyu mod ile birkaç vurgu rengi. Seçim hatırlanır.
- CloudCLI'ın arayüzünden esinlenilir.

**GitHub düzeni:**

```
scriptorium/
├── README.md, LICENSE (MIT), .gitignore, .env.example
├── package.json          (npm workspaces: server, web)
├── docs/PLAN.md
├── server/               (Node/TS arka uç)
│   ├── agents.example.json
│   └── src/
└── web/                  (React + HeroUI + react-three-fiber)
```

- Sırlar (API anahtarları) sadece `.env` dosyasında durur, `.gitignore`'da yer alır. Repoya `.env.example` girer.
- Kişisel işçi listesi `server/agents.json` da gitignore'da. Repoya `agents.example.json` girer.

**Ortam (2026-11-07'de kontrol edildi):**
- Node v22.19, Claude Code CLI 2.1.263 (npm ile kurulu).
- `pathToClaudeCodeExecutable` için `claude.ps1` kısayolu değil, gerçek dosya yolu bulunacak.

## "Eksiksiz entegrasyon" kontrol listesi (sohbet paneli)

- [x] Ajan seçici: Claude, DeepSeek ve local modeller. Her ajanın ayrı sohbet geçmişi var.
- [x] Akış halinde cevap, düşünme blokları açılıp kapanıyor.
- [x] Claude'un araç çağrıları kartlarla gösteriliyor: okuma, komut, Edit/Write için kırmızı-yeşil fark, yapılacaklar listesi, alt ajan adımları girintili.
- [x] İzin onayı: İzin ver / Her zaman izin ver / Reddet. Claude'un seçenekli soruları (AskUserQuestion) da cevaplanabiliyor.
- [x] Durdurma butonu
- [x] Oturum geçmişi: terminaldeki Claude Code oturumlarıyla ortak. Açılabiliyor, yeniden adlandırılabiliyor, silinebiliyor. Sayfa yenilenince kaldığı yerden devam ediyor.
- [x] "→ DeepSeek'e devredildi" kartı ve 3D'de karakterin masaya yürümesi
- [x] Tanınmayan mesaj türleri genel kartla gösteriliyor (Claude Code güncellemelerine dayanıklı).
- [x] Yan sohbet (forkSession): ana sohbetin bağlamını biliyor, ana sohbete karışmıyor.
- [x] Mesaja alıntıyla yanıt verme (seçili metin ya da mesajın tamamı)
- [x] Tema seçici (açık/koyu/sistem + 6 vurgu rengi) ve pixel görünüm anahtarı
- [x] **Oturum bilgi paneli** (sağ üst): ortam ve git dalı, ek klasörler, bağlam doluluğu, bağlayıcılar (aç/kapa, yeniden bağlan), çıktılar (yazılan dosyalar), git değişiklikleri (+/− ve diff), arka plan görevleri (durdurulabilir) ve işçi işleri
- [x] **"+" menüsü** (sol alt): dosya veya fotoğraf ekle (görsel, PDF, metin; yapıştırma ve sürükle-bırak da çalışıyor), klasör ekle, slash komutları, bağlayıcılar, eklentiler
- [x] Slash komut önerileri: `/` yazınca açılıyor, ok tuşları ve Tab/Enter ile seçiliyor.
- [x] Yazma kutusu altında çubuk: klasör seçici (projeler + klasör gezgini), model / efor / hızlı mod menüsü, izin modu, kullanım halkası
- [x] Üst barda abonelik kullanım limitleri (5 saatlik, 7 günlük)
- [x] Geçmiş paneli projelere göre gruplu (PROJECTS_DIR otomatik). Sağ tık menüsü: yeni sohbet, yolu kopyala, gizle/göster, tüm sohbetleri sil (onaylı, dosyalara dokunmaz), sohbet aç/yeniden adlandır/sil.
- [x] 3D etiketleri drei <Html> yerine sahne üstü katmanda: React 19'da kaybolma sorunu çözüldü
- [x] Karanlık modda meşaleler ve mangal (titreyen sıcak ışık)
- [ ] Terminal sekmesi (opsiyonel, sonraya bırakıldı): gerçek Claude Code ekranı. node-pty yerel derleme gerektiriyor.

## Senin yapacakların (en son, ~15 dk)

1. Bankadan sanal kart aç. Limiti 2-5 $, internet ve yurtdışı işlemleri açık olsun.
2. platform.deepseek.com üzerinde hesap aç, bakiye yükle, bir API anahtarı oluştur.
3. Anahtarı proje kökündeki `.env` dosyasına ekle (anahtarı sohbete yapıştırma): `DEEPSEEK_API_KEY=sk-...`
4. Ollama'yı kur ve modeli indir:
   `winget install Ollama.Ollama`, ardından `ollama pull hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ2_S` ve README'deki "Local model" adımları
5. Sunucuyu yeniden başlat (`npm run dev`). İşçilerin yanındaki kırmızı nokta yeşile dönmeli.

## Aşamalar

### Aşama 1: Arka uç iskeleti + işçi araçları ✅
- [x] Agent SDK, `pathToClaudeCodeExecutable` ile kurulu `claude`'a bağlanıyor. Abonelik girişiyle, CLI kendini güncellediğinde yeni sürüm otomatik kullanılıyor.
- [x] SDK içi MCP işçi araçları: `list_workers`, `ask_worker`, `start_job`, `job_status` (`alwaysLoad`). Gizlilik kuralı: `sensitive: true` sadece local işçilere gider.
- [x] DeepSeek ve Ollama için tek bir OpenAI uyumlu istemci, `max_tokens` limiti
- [x] DeepSeek bağlandı (2026-11-07): bakiye okunuyor, doğrudan sohbet uçtan uca çalışıyor (cevap 1,1 sn), 3D durumları doğru. Claude'un devretme testi kullanıcıyla yapılacak.

### Aşama 2: Sohbet arayüzü ✅
- [x] WebSocket köprüsü: sadece 127.0.0.1'e açık, yalnızca izinli arayüz adreslerinden bağlantı kabul ediyor.
- [x] Yukarıdaki kontrol listesi (terminal sekmesi hariç)

### Aşama 3: 3D sahne ✅
- [x] İzometrik ofis-kütüphane (ortografik kamera, pixel görünüm). Claude arkada baş masada, işçiler sıra sıra monitörlü masalarda.
- [x] Durumlar:
  - çalışıyor: masada yazıyor, ekran yanıyor, görev etiketi görünüyor
  - boşta: dinlenme köşesinde kitap okuyor
  - yer kalmazsa: masada uyukluyor
  - hata: kırmızı etiket, 12 sn sonra kendiliğinden boşta durumuna dönüyor
- [x] Karaktere tıklamak o ajanı seçiyor. Açık ve koyu modda aydınlatma farklı.

### Aşama 4: İşçi ekleme + arka plan işleri ✅
- [x] "İşçi ekle" penceresi: ekle, düzenle, sil. `agents.json`'a yazıyor, Claude yeni işçiyi hemen görüyor.
- [x] `start_job` / `job_status` iş kuyruğu. Aynı işçinin işleri sırayla çalışıyor.

## Sınırlar (unutma)

- Devretmek en çok şu işlerde kazandırır:
  - net tanımlı, kendi içinde kapalı kod görevleri
  - büyük girdi alıp küçük çıktı veren işler
  - gizli veri
- Karmaşık debug ve mimari kararlar Claude'da kalmalı.
- Bilgisayar: RTX 4060 Laptop (8 GB VRAM), 16 GB RAM. Local model 16K bağlamla çalışıyor (4K: %15 daha hızlı, 32K: %25 daha yavaş ve 11 GB bellek).
