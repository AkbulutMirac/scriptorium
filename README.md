# Scriptorium

Claude baş yazıcı, DeepSeek ve local LLM'ler yazıcı. Tek arayüzden hepsiyle konuşabildiğin, Claude'un işleri diğer modellere kendi kararıyla dağıttığı çok ajanlı bir çalışma alanı. Ajanların ne yaptığı şirin bir 3D kütüphanede canlı olarak görünüyor.

> **Durum:** Geliştirme aşamasında. Aşama 1/4 (arka uç) üzerinde çalışılıyor. Ayrıntılı plan: [docs/PLAN.md](docs/PLAN.md)

## Nasıl çalışır

```
Tarayıcı (React + HeroUI + react-three-fiber)
   │  WebSocket
Arka uç (Node / TypeScript)
   ├─ Claude Agent SDK → kurulu Claude Code (patron)
   │     └─ işçi araçları (SDK içi MCP): list_workers, ask_worker
   ├─ DeepSeek API      (işçi)
   └─ Ollama            (local işçiler)
```

- **Claude** bilgisayarında kurulu Claude Code üzerinden çalışır. CLAUDE.md, MCP sunucuları ve skill'lerin terminaldekiyle aynıdır. Claude Code güncellendikçe yeni özellikler kendiliğinden gelir.
- **İşçiler** (DeepSeek, Ollama modelleri) `server/agents.json` dosyasında tanımlanır. Claude, `ask_worker` aracıyla onlara iş devreder: net tanımlı kod görevleri DeepSeek'e, gizli veriler local modellere gider.

## Gereksinimler

- Node.js 22+
- [Claude Code](https://code.claude.com) CLI. Giriş yapılmış olmalı: terminalde `claude` çalıştırıp `/login`.
- (Opsiyonel) [DeepSeek API](https://platform.deepseek.com) anahtarı
- (Opsiyonel) [Ollama](https://ollama.com)

## Kurulum

```bash
git clone https://github.com/AkbulutMirac/scriptorium.git
cd scriptorium
npm install
cp .env.example .env   # değerleri doldur
```

Terminalden deneme (arayüz hazır olana kadar):

```bash
npm run cli                 # sohbet modu, /yan <mesaj> ile yan sohbet
npm run cli -- "mesajın"    # tek mesaj
```

## Lisans

[MIT](LICENSE)
