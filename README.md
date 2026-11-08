# Scriptorium

Claude baş yazıcı, DeepSeek ve local LLM'ler yazıcı. Tek arayüzden hepsiyle konuşabildiğin, Claude'un işleri diğer modellere kendi kararıyla dağıttığı çok ajanlı bir çalışma alanı. Kimin ne yaptığı izometrik, piksel görünümlü bir ofis-kütüphanede canlı olarak görünüyor.

![Scriptorium: ortada 3D ofis, sağda sohbet. Aynı anda üç DeepSeek işi çalışıyor](docs/screenshot.png)

**Neden:** Claude kullanım limitini korumak. Net tanımlı kod işlerini, özetleri ve sınıflandırmaları ucuz DeepSeek'e ya da bedava local modellere verir, sonucu kendisi kontrol eder.

## Hızlı başlangıç

Gereken tek şey [Node.js 22.9+](https://nodejs.org) ve bir Claude aboneliği (Pro ya da Max).

```bash
git clone https://github.com/AkbulutMirac/scriptorium.git
cd scriptorium
npm install
npm run app
```

Tarayıcıda http://localhost:7777 adresini aç. İlk açılışta **Kurulum** penceresi her şeyi adım adım yaptırır:

1. **Claude hesabı:** "Claude ile giriş yap" tarayıcıda Anthropic'in giriş sayfasını açar. Claude Code'u ayrıca kurman gerekmez, Scriptorium kendi sürümünü kullanır.
2. **DeepSeek (isteğe bağlı):** [platform.deepseek.com](https://platform.deepseek.com/api_keys) adresinden bir API anahtarı al ve yapıştır. Anahtar denenir, çalışırsa sadece bu bilgisayardaki `.env` dosyasına yazılır.
3. **Local modeller (isteğe bağlı):** [Ollama](https://ollama.com/download)'yı kur, bir model indir (`ollama pull qwen3.5:9b` gibi). Kurulu modellerini tek tıkla işçi olarak eklersin.
4. **Bütün Claude Code oturumlarında (isteğe bağlı):** Terminaldeki ve Claude masaüstü uygulamasındaki Claude da işçileri kullanabilsin diye işçi araçlarını ve devretme kurallarını tek tıkla ekler.

Kurulum penceresine sonra Ayarlar menüsünden dönebilirsin.

**Windows kısayolu:** Masaüstüne pencere açmadan çalışan bir kısayol koymak için:

```bash
powershell -ExecutionPolicy Bypass -File scripts\Kisayol.ps1
```

Kısayol ilk açılışta paketleri kurar, arayüzü derler, sunucuyu arka planda başlatır ve tarayıcıyı açar. Sunucu zaten çalışıyorsa sadece tarayıcıyı açar. Kapatmak için arayüzde Ayarlar → "Scriptorium'u kapat". Çıktılar `server\data\*.log` dosyalarına yazılır.

## Özellikler

**Claude (baş yazıcı)**
- Claude Code'a bağlanır. CLAUDE.md, MCP sunucuları, skill'ler ve eklentiler terminaldekiyle aynıdır. Claude Code güncellendikçe yeni özellikler kendiliğinden gelir.
- Akış halinde cevap, düşünme blokları, araç kartları (Edit ve Write için kırmızı-yeşil fark), izin onayı ve seçenekli soruları cevaplama.
- **Yan sohbet:** Ana sohbeti bozmadan bir mesaj hakkında ayrı konuşma açılır. Mesaja alıntıyla yanıt verilebilir.
- **Oturum bilgi paneli:** klasör ve git dalı, ek klasörler, bağlam doluluğu, bağlayıcılar (aç/kapa, yeniden bağlan), yazılan dosyalar, git değişiklikleri (diff), arka plan görevleri.
- **"+" menüsü:** dosya veya fotoğraf ekleme (yapıştırma ve sürükle-bırak dahil), klasör ekleme, slash komutları (`/` ile öneri), bağlayıcılar ve eklentiler.
- Yazma kutusunun altında Claude uygulamasındaki gibi bir çubuk: çalışma klasörü seçici, model, efor (Düşük–Maks) ve hızlı mod menüsü, izin modu, kullanım halkası.
- Üst barda Claude aboneliğinin kullanım limitleri (5 saatlik ve 7 günlük).
- Geçmiş paneli projelere göre gruplanmıştır ve terminaldeki Claude Code oturumlarıyla ortaktır. Uygulama en son açık olan sohbetle açılır.

**İşçiler (DeepSeek, Ollama)**
- Her işçiyle doğrudan sohbet edilebilir. Görsel ve dosya eklenebilir (DeepSeek PDF de okur).
- Yazma kutusunun altında model seçimi, düşünme seviyesi, sıcaklık, en fazla token, JSON çıktı, sistem talimatı, token kullanımı ve bağlam doluluğu.
- Claude işçilere araçlarla iş devreder: `ask_worker` cevabı bekler, `start_job` ve `job_status` arka planda çalışır.
- Araçlar terminaldeki ve masaüstü uygulamasındaki bütün Claude Code oturumlarında da kullanılabilir.
- Birden fazla oturum aynı işçiyi aynı anda kullanabilir. 3D ofiste her iş için işçinin bir kopyası odaya girip ek masaya oturur, iş bitince çıkar. Local işçiler aynı anda tek iş yapar, diğerleri sıraya girer.
- Bir işçinin üzerine gelince hangi işi, hangi proje için ve ne zamandır yaptığı görünür.
- Gizli veri (`sensitive`) sadece local işçilere gider.
- İşçiler arayüzden eklenir, düzenlenir, silinir (`server/agents.json`). Varsayılan olarak DeepSeek Flash ve Pro gelir.
- DeepSeek kalan bakiyesi üst barda görünür.

**Arayüz:** React, HeroUI v3 ve react-three-fiber. Açık, koyu ya da sistem teması, 6 vurgu rengi, piksel görünüm.

## Nasıl çalışır

```
Tarayıcı (React + HeroUI + react-three-fiber)
   │  WebSocket (sadece 127.0.0.1, sadece izinli arayüz adresleri)
Arka uç (Node / TypeScript)
   ├─ Claude Agent SDK → Claude Code (baş yazıcı)
   ├─ İşçi araçları: list_workers, ask_worker, start_job, job_status
   │     └─ /mcp adresinde HTTP MCP sunucusu: diğer Claude Code oturumları da bağlanır
   ├─ DeepSeek API      (işçi, OpenAI uyumlu)
   └─ Ollama            (local işçiler, OpenAI uyumlu)
```

## Ayarlar (`.env`, hepsi isteğe bağlı)

Kurulum penceresi DeepSeek anahtarını kendisi yazar. Diğer ayarlar için `.env.example` dosyasını `.env` olarak kopyala.

| Ayar | Açıklama |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek işçileri için |
| `CLAUDE_CODE_PATH` | Kendi kurduğun `claude` programını kullanmak için yolu. Boşsa Scriptorium'un kendi sürümü. |
| `CLAUDE_CWD` | Claude'un varsayılan çalışma klasörü (arayüzden de değiştirilebilir) |
| `PROJECTS_DIR` | Proje klasörlerinin durduğu yer. Klasör seçicide ve geçmişte otomatik listelenir. |
| `PROJECTS_EXCLUDE` | Listelerde hiç görünmeyecek klasörler (adlar ya da tam yollar, virgülle). Klasörlere dokunulmaz. |
| `OLLAMA_BASE_URL` | Ollama başka bir adreste çalışıyorsa |
| `WORKER_MAX_TOKENS` | İşçi çağrısı başına en fazla çıktı (maliyet güvenliği) |
| `PORT` | Arka uç portu (varsayılan 7777) |

## Local model seçimi

Local işçiye kısa ve tek adımlı işler gider (sınıflandırma, kısa özet, gizli veri içeren küçük işler). Model ekran kartının belleğine tamamen sığarsa hızlı çalışır:

- **8 GB ekran kartı:** `qwen3.5:9b` (6,6 GB) tamamen sığar ve hızlıdır. Daha güçlü ama yavaş bir seçenek: `hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ2_S` (9,3 GB). RTX 4060 Laptop'ta saniyede ~3,7 token.
- **12 GB ve üstü:** 14B–27B modeller.

Görsel okumayan bir model için Ollama'nın görsel modülünü çıkarmak hızlandırır ve ek disk yeri harcamaz:

```bash
ollama show --modelfile <model> > model.Modelfile
```

`model.Modelfile` içindeki ikinci `FROM` satırını sil, bağlamı büyütmek istersen en sona `PARAMETER num_ctx 16384` ekle, sonra:

```bash
ollama create <yeni-ad> -f model.Modelfile
```

Local işçilerde düşünme varsayılan olarak kapalıdır (küçük modellerde açıkken dakikalar sürer). İşçi panelinin altındaki menüden açılabilir.

## Geliştirme

```bash
npm run dev        # geliştirme: http://localhost:5173 (sunucu kod değişince yeniden başlar)
```

```bash
npm run typecheck  # tip kontrolü
```

```bash
npm run cli        # terminalden deneme (/yan <mesaj> ile yan sohbet)
```

Ayrıntılı tasarım kararları: [docs/PLAN.md](docs/PLAN.md)

## Güvenlik

- Arka uç sadece bu bilgisayardan erişilebilir (`127.0.0.1`).
- WebSocket ve MCP adresi yalnızca bu bilgisayardan ve kendi arayüzünün adreslerinden istek kabul eder. Tarayıcıda açık başka bir site Claude'u ya da işçileri kontrol edemez.
- API anahtarları sadece `.env` dosyasında durur, repoya girmez ve arayüze geri gönderilmez.
- Claude'un komut ve dosya işlemleri, izin modu "Her adımda sor" olduğunda arayüzde onay ister.
- DeepSeek'e giden veri DeepSeek'in sunucularına gider. Gizli işler için `sensitive: true` ve local işçi kullan.

## Lisans

[MIT](LICENSE)
