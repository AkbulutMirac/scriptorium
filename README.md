# Scriptorium

Claude baş yazıcı, DeepSeek ve local LLM'ler yazıcı. Tek arayüzden hepsiyle konuşabildiğin, Claude'un işleri diğer modellere kendi kararıyla dağıttığı çok ajanlı bir çalışma alanı. Kimin ne yaptığı izometrik, piksel görünümlü bir ofis-kütüphanede canlı olarak görünüyor.

> **Durum:** Arayüz ve Claude tarafı tamam. DeepSeek ve Ollama işçileri, anahtar ve kurulum yapılınca çalışır. Ayrıntılı plan: [docs/PLAN.md](docs/PLAN.md)

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
- Oturum geçmişi terminaldeki Claude Code ile ortaktır. Model ve izin modu seçilebilir.

**İşçiler (DeepSeek, Ollama)**
- Her işçiyle doğrudan sohbet edilebilir.
- Claude işçilere araçlarla iş devreder: `ask_worker` için cevap beklenir, `start_job` ve `job_status` arka planda çalışır.
- Gizli veri (`sensitive`) sadece local işçilere gider.
- İşçiler arayüzden eklenir, düzenlenir, silinir (`server/agents.json`).

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

## Güvenlik

- Arka uç sadece bu bilgisayardan erişilebilir (`127.0.0.1`).
- WebSocket yalnızca kendi arayüzünün adreslerinden bağlantı kabul eder. Tarayıcıda açık başka bir site Claude'u kontrol edemez.
- API anahtarları sadece `.env` dosyasında durur, repoya girmez.
- Claude'un komut ve dosya işlemleri, izin modu "Her adımda sor" olduğunda arayüzde onay ister.

## Lisans

[MIT](LICENSE)
