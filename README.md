# Scriptorium

Claude baş yazıcı, DeepSeek ve local LLM'ler yazıcı. Tek arayüzden hepsiyle konuşabildiğin, Claude'un işleri diğer modellere kendi kararıyla dağıttığı çok ajanlı bir çalışma alanı. Kimin ne yaptığı izometrik, piksel görünümlü bir ofis-kütüphanede canlı olarak görünüyor.

> **Durum:** Claude ve DeepSeek tarafı çalışıyor. Local işçiler Ollama kurulunca çalışır. Ayrıntılı plan: [docs/PLAN.md](docs/PLAN.md)

## Özellikler

**Claude (baş yazıcı)**
- Bilgisayarında kurulu Claude Code'a bağlanır. CLAUDE.md, MCP sunucuları, skill'ler ve eklentiler terminaldekiyle aynıdır. Claude Code güncellendikçe yeni özellikler kendiliğinden gelir.
- Akış halinde cevap, düşünme blokları, araç kartları (Edit ve Write için kırmızı-yeşil fark), izin onayı ve seçenekli soruları cevaplama.
- **Yan sohbet:** Ana sohbeti bozmadan bir mesaj hakkında ayrı konuşma açılır. Mesaja alıntıyla yanıt verilebilir.
- **Oturum bilgi paneli:**
  - klasör ve git dalı, ek klasörler
  - bağlam doluluğu
  - bağlayıcılar (aç/kapa, yeniden bağlan)
  - yazılan dosyalar ve git değişiklikleri (diff)
  - arka plan görevleri
- **"+" menüsü:** dosya veya fotoğraf ekleme (yapıştırma ve sürükle-bırak dahil), klasör ekleme, slash komutları (`/` ile öneri), bağlayıcılar ve eklentiler.
- Yazma kutusunun altında Claude uygulamasındaki gibi bir çubuk var: çalışma klasörü seçici (projeler ve klasör gezgini), model, efor (Düşük–Maks) ve hızlı mod menüsü, izin modu, kullanım halkası.
- Üst barda Claude aboneliğinin kullanım limitleri görünür (5 saatlik ve 7 günlük).
- Geçmiş paneli projelere göre gruplanmıştır ve terminaldeki Claude Code oturumlarıyla ortaktır. `PROJECTS_DIR` altındaki klasörler otomatik gelir. Sağ tık menüsünden yeni sohbet açılabilir, proje listeden gizlenebilir, sohbetler yeniden adlandırılıp silinebilir.

**İşçiler (DeepSeek, Ollama)**
- Her işçiyle doğrudan sohbet edilebilir. Görsel ve dosya eklenebilir (DeepSeek PDF de okur). Yapıştırma ve sürükle-bırak da çalışır.
- Yazma kutusunun altındaki çubukta model seçimi, düşünme seviyesi (Kapalı–Maks), sıcaklık, en fazla token, JSON çıktı ve sistem talimatı var. Ayarlar işçi başına hatırlanır.
- Cevaplarda modelin düşüncesi açılır bir blokta, token kullanımı (önbellek ve düşünme dahil) mesajın altında görünür.
- Claude işçilere araçlarla iş devreder: `ask_worker` için cevap beklenir, `start_job` ve `job_status` arka planda çalışır.
- Araçlar sadece Scriptorium'da değil, terminaldeki ve masaüstü uygulamasındaki bütün Claude Code oturumlarında da kullanılabilir (aşağıda "Bütün Claude Code oturumlarında").
- Birden fazla oturum aynı işçiyi aynı anda kullanabilir. 3D ofiste her iş için işçinin bir kopyası odaya girip ek masaya oturur, iş bitince çıkar. Local işçiler aynı anda tek iş yapar, diğerleri sıraya girer.
- Bir işçinin üzerine gelince hangi işi, hangi proje için ve ne zamandır yaptığı görünür.
- Gizli veri (`sensitive`) sadece local işçilere gider.
- İşçiler arayüzden eklenir, düzenlenir, silinir (`server/agents.json`).
- DeepSeek kalan bakiyesi üst barda ve DeepSeek sohbetinde görünür (5 dakikada bir ve her DeepSeek işinden sonra güncellenir).

**Arayüz:** React, HeroUI v3 ve react-three-fiber ile yapıldı. Açık, koyu ya da sistem teması ve 6 vurgu rengi var. Piksel görünüm açılıp kapatılabilir.

## Nasıl çalışır

```
Tarayıcı (React + HeroUI + react-three-fiber)
   │  WebSocket (sadece 127.0.0.1, sadece izinli arayüz adresleri)
Arka uç (Node / TypeScript)
   ├─ Claude Agent SDK → kurulu Claude Code (baş yazıcı)
   │     └─ işçi araçları (SDK içi MCP): list_workers, ask_worker, start_job, job_status
   ├─ DeepSeek API      (işçi, OpenAI uyumlu)
   └─ Ollama            (local işçiler, OpenAI uyumlu)
```

## Gereksinimler

- Node.js 22+
- [Claude Code](https://code.claude.com) CLI. Giriş yapılmış olmalı: terminalde `claude`, ardından `/login`, ardından "Claude account with subscription".
- (Opsiyonel) [DeepSeek API](https://platform.deepseek.com) anahtarı
- (Opsiyonel) [Ollama](https://ollama.com)

## Kurulum

```bash
git clone https://github.com/AkbulutMirac/scriptorium.git
cd scriptorium
npm install
cp .env.example .env   # değerleri doldur (Windows: copy .env.example .env)
```

`.env` içindeki önemli ayarlar:

| Ayar | Açıklama |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek işçileri için |
| `CLAUDE_CODE_PATH` | Kurulu `claude` programının yolu. Boş bırakılırsa SDK'nın kendi sürümü kullanılır. |
| `CLAUDE_CWD` | Claude'un varsayılan çalışma klasörü (arayüzden de değiştirilebilir) |
| `PROJECTS_DIR` | Proje klasörlerinin durduğu yer. Klasör seçicide ve geçmişte otomatik listelenir. |
| `WORKER_MAX_TOKENS` | İşçi çağrısı başına en fazla çıktı (maliyet güvenliği) |

## Çalıştırma

```bash
npm run dev      # geliştirme: http://localhost:5173
```

```bash
npm run build    # arayüzü derle
npm start        # tek sunucu: http://localhost:7777
```

```bash
npm run cli      # terminalden deneme (/yan <mesaj> ile yan sohbet)
```

### Bütün Claude Code oturumlarında

Scriptorium çalışırken işçi araçları `http://127.0.0.1:7777/mcp` adresinde bir MCP sunucusu olarak da açıktır. Terminaldeki ve masaüstü uygulamasındaki Claude Code oturumlarına bir kez eklemek yeterli:

```bash
claude mcp add --scope user --transport http scriptorium http://127.0.0.1:7777/mcp
```

Claude'un ne zaman iş devredeceğini bilmesi için [docs/CLAUDE-isciler.md](docs/CLAUDE-isciler.md) içeriğini kendi `~/.claude/CLAUDE.md` dosyana ekle. Bütün oturumların işleri aynı sıraya girer ve 3D ofiste proje adıyla görünür. Scriptorium kapalıyken bu sunucu Claude Code'da "bağlanamadı" görünür; başka bir şeyi etkilemez.

**Windows kısayolu:** `scripts\Scriptorium.vbs` pencere açmadan arayüzü derler, sunucuyu arka planda başlatır ve tarayıcıyı açar. Sunucu zaten çalışıyorsa sadece tarayıcıyı açar. Masaüstü kısayolu için hedefi `wscript.exe "<repo>\scripts\Scriptorium.vbs"`, simgesi `scripts\scriptorium.ico` olan bir kısayol oluştur. Sunucuyu kapatmak için arayüzde Ayarlar → "Scriptorium'u kapat". Çıktılar `server\data\server.log` ve `build.log` dosyalarına yazılır.

## Güvenlik

- Arka uç sadece bu bilgisayardan erişilebilir (`127.0.0.1`).
- WebSocket yalnızca kendi arayüzünün adreslerinden bağlantı kabul eder. Tarayıcıda açık başka bir site Claude'u kontrol edemez.
- API anahtarları sadece `.env` dosyasında durur, repoya girmez.
- Claude'un komut ve dosya işlemleri, izin modu "Her adımda sor" olduğunda arayüzde onay ister.

## Lisans

[MIT](LICENSE)
