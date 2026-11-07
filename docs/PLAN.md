# Scriptorium — Plan

**Durum:** Aşama 1 devam ediyor (başlangıç 2026-11-07).
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
  - `hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ2_XS` (8.4 GB): ~10-15 token/sn (tahmini)
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

- [ ] Ajan seçici: Claude (varsayılan), DeepSeek veya herhangi bir local model. Her ajanın ayrı sohbet geçmişi olur.
- [ ] Akış halinde cevap (streaming), düşünme bloklarını açıp kapatma
- [ ] Claude'un araç çağrılarını gösterme: okuduğu dosya, çalıştırdığı komut, diff
- [ ] İzin onayı: Claude bir komut çalıştırmak istediğinde arayüzde Onayla / Reddet
- [ ] Durdurma butonu (cevabı yarıda kesme)
- [ ] Oturum geçmişi, eski sohbete dönme
- [ ] Claude bir işçiye iş verdiğinde sohbette "→ DeepSeek'e devredildi" kartı görünmesi ve 3D sahnede ilgili karakterin hareket etmesi
- [ ] Tanınmayan mesaj türleri için genel kart (Claude Code güncellemelerinde arayüz bozulmasın diye)
- [ ] Yan sohbet (side chat), ana sohbetten çatallanan ayrı oturum
- [ ] Mesaja yanıt verme (alıntı)
- [ ] Tema seçici (açık/koyu + vurgu rengi)
- [ ] Terminal sekmesi (opsiyonel): gerçek Claude Code ekranı

## Başlamadan önce senin yapacakların (~15 dk)

1. Bankadan sanal kart aç. Limiti 2-5 $, internet ve yurtdışı işlemleri açık olsun.
2. platform.deepseek.com üzerinde hesap aç, bakiye yükle, bir API anahtarı oluştur.
3. Anahtarı ortam değişkenine ekle (anahtarı sohbete yapıştırma):
   `setx DEEPSEEK_API_KEY "anahtarın"`
4. Ollama'yı kur ve modelleri indir:
   `winget install Ollama.Ollama`, ardından `ollama pull hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ2_XS`

## Aşamalar

### Aşama 1: Arka uç iskeleti + işçi araçları (~2-3 saat)
- [x] Node/TS projesi. Agent SDK, `pathToClaudeCodeExecutable` ile kurulu `claude`'a bağlanıyor (Claude Code 2.1.263, işçi araçları kayıtlı). `npm run cli` ile test ediliyor.
  - [x] Canlı sohbet testi: abonelik girişiyle bağlanıyor, Claude `list_workers`'ı kendisi çağırıp doğru cevap veriyor. İşçi araçları `alwaysLoad` ile en baştan yüklü.
  - [x] Yan sohbet (forkSession) testi: yan sohbet ana bağlamı biliyor, yan sohbette söylenenler ana sohbete sızmıyor, oturum kimlikleri farklı.
  - [ ] Uçtan uca DeepSeek testi ("DeepSeek'e fonksiyon yazdır, test geçsin"). DeepSeek anahtarı gelince yapılacak.
- [x] DeepSeek ve Ollama için tek bir sohbet istemcisi (OpenAI uyumlu), `max_tokens` limiti. DeepSeek anahtarı ve Ollama gelince test edilecek.
- [x] `agents.json` ve işçi araçları (SDK içi MCP, sunucu adı `workers`)
- **Bitti sayılması için:** Terminalden Claude'a "DeepSeek'e şu fonksiyonu yazdır" denince kodun gelmesi ve testin geçmesi.

### Aşama 2: Sohbet arayüzü (~1-2 gün)
- [ ] WebSocket köprüsü. SDK mesajları arayüze ham haliyle iletilir: arayüz tanıdıklarını özel gösterir, tanımadıklarını genel kartla.
- [ ] Geçmiş paneli için SDK'nın oturum fonksiyonları: `listSessions`, `getSessionMessages`, `renameSession`, `deleteSession`. Bunlar terminaldeki Claude Code oturumlarıyla ortak.
- [ ] Yukarıdaki "eksiksiz entegrasyon" listesinin tamamı
- **Bitti sayılması için:** Tarayıcıdan Claude'la Claude Code'daki gibi çalışılabilmesi ve işçilerle doğrudan sohbet edilebilmesi.

### Aşama 3: 3D kütüphane (~3-5 saat)
- [ ] react-three-fiber ile sahne: Claude ortada kütüphaneci, her işçi bir karakter
- [ ] Durumlar: boşta (koltukta kitap okuyor 💤), çalışıyor (masada, kafasının üstünde görev baloncuğu), hata (kırmızı)
- **Bitti sayılması için:** Claude iş verdiğinde karakterin masaya geçmesi, iş bitince koltuğa dönmesi.

### Aşama 4: İşçi ekleme + arka plan işleri + cila (~3-4 saat)
- [ ] "+" butonu ve form. Form `agents.json`'a yazar, Claude yeni işçiyi `list_workers` ile görür.
- [ ] `start_job` / `job_status`: iş kuyruğu, hassas işlerin yalnızca local'e yönlendirilmesi
- **Bitti sayılması için:** Arayüzden eklenen işçiye Claude'un iş verebilmesi, uzun bir local işin arka planda bitmesi.

## Sınırlar (unutma)

- Devretmek en çok şu işlerde kazandırır:
  - net tanımlı, kendi içinde kapalı kod görevleri
  - büyük girdi alıp küçük çıktı veren işler
  - gizli veri
- Karmaşık debug ve mimari kararlar Claude'da kalmalı.
- Bilgisayar: RTX 4060 Laptop (8 GB VRAM), 16 GB RAM. Local modellerde pratik bağlam ~16K.
