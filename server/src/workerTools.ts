import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { findWorker, loadWorkers, type Worker } from "./agents.js";
import { getJob, listJobs, startJob } from "./jobs.js";
import { isAvailable } from "./llm.js";
import { runWorkerTask } from "./workerTasks.js";

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

/** İşçiyi bulur ve gizlilik kuralını uygular. Sorun varsa hata metni döner. */
async function pickWorker(workerId: string, sensitive?: boolean): Promise<Worker | string> {
  const worker = await findWorker(workerId);
  if (!worker) return `Böyle bir işçi yok: ${workerId}. list_workers ile bak.`;
  if (sensitive && !worker.local) {
    return `Hassas veri sadece local işçilere gönderilebilir. ${worker.name} local değil; local: true olan bir işçi seç.`;
  }
  return worker;
}

const commonArgs = {
  worker_id: z.string().describe("list_workers'taki işçi id'si"),
  task: z.string().describe("İşçiye verilecek görev, kendi başına anlaşılır şekilde"),
  files: z.array(z.string()).optional().describe("Proje klasörüne göre dosya yolları. Araç dosyaları okuyup işçiye gönderir."),
  sensitive: z
    .boolean()
    .optional()
    .describe("Görev veya dosyalar gizli/kişisel veri içeriyorsa true. true ise sadece local işçiler kabul edilir."),
};

/** Claude'a verilen işçi araçları. Claude Code içinde mcp__workers__* adıyla görünür. */
export function createWorkerServer(cwd: string) {
  return createSdkMcpServer({
    name: "workers",
    version: "0.1.0",
    tools: [
      tool(
        "list_workers",
        "İşçi modelleri (DeepSeek, local LLM'ler) açıklamalarıyla listeler ve her birine şu an ulaşılabilir olup olmadığını söyler.",
        {},
        async () => {
          const workers = await loadWorkers();
          const rows = await Promise.all(
            workers.map(async (w) => ({
              id: w.id,
              name: w.name,
              model: w.model,
              local: w.local,
              description: w.description,
              available: await isAvailable(w),
            })),
          );
          return ok(JSON.stringify(rows, null, 2));
        },
        { alwaysLoad: true },
      ),
      tool(
        "ask_worker",
        [
          "Bir işi işçi modele devreder ve cevabını bekleyip döndürür.",
          "İşçi dosya okuyamaz, yazamaz ve komut çalıştıramaz: ihtiyaç duyduğu dosyaları `files` ile ver. Gelen kodu dosyaya yazmak ve test etmek senin işin.",
          "Ne zaman kullanılır: net tanımlı, kendi içinde kapalı kod görevleri (fonksiyon, script, test, kod dönüştürme); büyük girdi alıp küçük çıktı veren işler (özet, sınıflandırma).",
          "Ne zaman kullanılmaz: projenin geneline bakmayı gerektiren debug ve mimari kararlar.",
          "Gizli veri için sensitive: true ver, o zaman sadece local işçiler kabul edilir. İşçinin cevabını kontrol etmeden doğru kabul etme.",
          "Birkaç dakikadan uzun sürecek işler (özellikle local modellerle toplu işler) için start_job kullan.",
        ].join(" "),
        commonArgs,
        async ({ worker_id, task, files, sensitive }) => {
          const worker = await pickWorker(worker_id, sensitive);
          if (typeof worker === "string") return fail(worker);
          try {
            return ok(await runWorkerTask({ worker, task, files, cwd }));
          } catch (err) {
            return fail(err instanceof Error ? err.message : String(err));
          }
        },
        { alwaysLoad: true },
      ),
      tool(
        "start_job",
        "Uzun sürecek bir işi işçiye arka planda başlatır ve hemen bir iş numarası döndürür. Sonucu job_status ile sor. Aynı işçinin işleri sırayla çalışır. Kurallar ask_worker ile aynı.",
        commonArgs,
        async ({ worker_id, task, files, sensitive }) => {
          const worker = await pickWorker(worker_id, sensitive);
          if (typeof worker === "string") return fail(worker);
          const job = startJob({ worker, task, files, cwd });
          return ok(`İş başlatıldı. İş numarası: ${job.id}. Sonucu job_status ile sor.`);
        },
        { alwaysLoad: true },
      ),
      tool(
        "job_status",
        "Arka plan işinin durumunu ve bittiyse sonucunu döndürür. job_id verilmezse son işleri listeler.",
        { job_id: z.string().optional().describe("start_job'un döndürdüğü iş numarası") },
        async ({ job_id }) => {
          if (job_id) {
            const job = getJob(job_id);
            return job ? ok(JSON.stringify(job, null, 2)) : fail(`Böyle bir iş yok: ${job_id}`);
          }
          const summary = listJobs()
            .slice(0, 20)
            .map(({ id, workerId, status, task }) => ({ id, workerId, status, task: task.slice(0, 100) }));
          return ok(JSON.stringify(summary, null, 2));
        },
        { alwaysLoad: true },
      ),
    ],
  });
}
