import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { z } from "zod";
import { findWorker, loadWorkers, type Worker } from "./agents.js";
import { getJob, listJobs, startJob } from "./jobs.js";
import { isAvailable } from "./llm.js";
import type { WorkerCaller } from "./protocol.js";
import { listRequests } from "./requests.js";
import { runWorkerTask } from "./workerTasks.js";

/** Aracı çağıran Claude oturumu: dosya yollarının göreli olduğu klasör ve 3D ofiste görünen adı */
export type ToolCtx = { cwd?: string; caller: WorkerCaller };

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

/** MCP sunucusunun Claude'a verdiği kullanım özeti (Claude Code bunu sistem talimatına ekler) */
export const WORKER_INSTRUCTIONS = [
  "Scriptorium işçileri: DeepSeek (API, ucuz ve hızlı) ve local LLM'ler (Ollama, veri bilgisayardan çıkmaz).",
  "Varsayılan deepseek-pro; kolay işler deepseek (Flash). Local işçiler küçük modeldir: önce list_workers ile modeline bak, sadece kısa ve tek adımlı işler ver.",
  "list_workers ile kimin hazır olduğuna bak. ask_worker cevabı bekler; birkaç dakikadan uzun işler için start_job, sonra job_status.",
  "İşçi dosya okuyamaz, yazamaz, komut çalıştıramaz: gereken dosyaları files ile ver ve project_dir olarak çalışma klasörünün tam yolunu yaz.",
  "Gelen kodu dosyaya yazmak ve test etmek senin işin. Gizli veri için sensitive: true (sadece local işçiler kabul eder).",
  "Birbirinden bağımsız işleri aynı anda birden fazla ask_worker çağrısıyla paralel verebilirsin; local işçiler sırayla çalışır.",
].join(" ");

/** İşçiyi bulur ve gizlilik kuralını uygular. Sorun varsa hata metni döner. */
async function pickWorker(workerId: string, sensitive?: boolean): Promise<Worker | string> {
  const worker = await findWorker(workerId);
  if (!worker) return `Böyle bir işçi yok: ${workerId}. list_workers ile bak.`;
  if (sensitive && !worker.local) {
    return `Hassas veri sadece local işçilere gönderilebilir. ${worker.name} local değil; local: true olan bir işçi seç.`;
  }
  return worker;
}

const taskArgs = {
  worker_id: z.string().describe("list_workers'taki işçi id'si"),
  task: z.string().describe("İşçiye verilecek görev, kendi başına anlaşılır şekilde"),
  files: z.array(z.string()).optional().describe("project_dir'e göre dosya yolları. Araç dosyaları okuyup işçiye gönderir."),
  project_dir: z
    .string()
    .optional()
    .describe("Çalışma klasörünün tam yolu. files verildiyse gerekli; 3D ofiste işin hangi projeden geldiği de buradan görünür."),
  sensitive: z
    .boolean()
    .optional()
    .describe("Görev veya dosyalar gizli/kişisel veri içeriyorsa true. true ise sadece local işçiler kabul edilir."),
};
type TaskArgs = { worker_id: string; task: string; files?: string[]; project_dir?: string; sensitive?: boolean };

/** project_dir verildiyse onu kullanır ve 3D ofisteki adı klasör adı yapar */
function withProjectDir(ctx: ToolCtx, projectDir?: string): ToolCtx {
  if (!projectDir) return ctx;
  return { cwd: projectDir, caller: { ...ctx.caller, label: path.basename(projectDir) || ctx.caller.label } };
}

/** Dört işçi aracı. Hem Scriptorium oturumlarında (SDK içi) hem diğer Claude Code oturumlarında (HTTP) aynı. */
export const WORKER_TOOLS = [
  {
    name: "list_workers",
    description:
      "İşçi modelleri (DeepSeek, local LLM'ler) açıklamalarıyla listeler: şu an ulaşılabilir mi, kaç iş yapıyor, kaçı sırada.",
    schema: {},
    handler: async (): Promise<ToolResult> => {
      const [workers, requests] = [await loadWorkers(), listRequests()];
      const rows = await Promise.all(
        workers.map(async (w) => ({
          id: w.id,
          name: w.name,
          model: w.model,
          local: w.local,
          description: w.description,
          available: await isAvailable(w),
          running: requests.filter((r) => r.workerId === w.id && r.status === "running").length,
          queued: requests.filter((r) => r.workerId === w.id && r.status === "queued").length,
        })),
      );
      return ok(JSON.stringify(rows, null, 2));
    },
  },
  {
    name: "ask_worker",
    description: [
      "Bir işi işçi modele devreder ve cevabını bekleyip döndürür.",
      "İşçi dosya okuyamaz, yazamaz ve komut çalıştıramaz: ihtiyaç duyduğu dosyaları `files` ile ver. Gelen kodu dosyaya yazmak ve test etmek senin işin.",
      "Ne zaman kullanılır: net tanımlı, kendi içinde kapalı kod görevleri (fonksiyon, script, test, kod dönüştürme); büyük girdi alıp küçük çıktı veren işler (özet, sınıflandırma).",
      "Ne zaman kullanılmaz: projenin geneline bakmayı gerektiren debug ve mimari kararlar.",
      "Gizli veri için sensitive: true ver, o zaman sadece local işçiler kabul edilir. İşçinin cevabını kontrol etmeden doğru kabul etme.",
      "Birkaç dakikadan uzun sürecek işler (özellikle local modellerle toplu işler) için start_job kullan.",
    ].join(" "),
    schema: taskArgs,
    handler: async (args: TaskArgs, ctx: ToolCtx): Promise<ToolResult> => {
      const worker = await pickWorker(args.worker_id, args.sensitive);
      if (typeof worker === "string") return fail(worker);
      const c = withProjectDir(ctx, args.project_dir);
      try {
        return ok(await runWorkerTask({ worker, task: args.task, files: args.files, cwd: c.cwd, caller: c.caller }));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    name: "start_job",
    description:
      "Uzun sürecek bir işi işçiye arka planda başlatır ve hemen bir iş numarası döndürür. Sonucu job_status ile sor. Aynı işçinin işleri sırayla çalışır. Kurallar ask_worker ile aynı.",
    schema: taskArgs,
    handler: async (args: TaskArgs, ctx: ToolCtx): Promise<ToolResult> => {
      const worker = await pickWorker(args.worker_id, args.sensitive);
      if (typeof worker === "string") return fail(worker);
      const c = withProjectDir(ctx, args.project_dir);
      if (args.files?.length && !c.cwd) return fail("Dosya göndermek için project_dir ver (proje klasörünün tam yolu).");
      const job = startJob({ worker, task: args.task, files: args.files, cwd: c.cwd, caller: c.caller });
      return ok(`İş başlatıldı. İş numarası: ${job.id}. Sonucu job_status ile sor.`);
    },
  },
  {
    name: "job_status",
    description: "Arka plan işinin durumunu ve bittiyse sonucunu döndürür. job_id verilmezse son işleri listeler.",
    schema: { job_id: z.string().optional().describe("start_job'un döndürdüğü iş numarası") },
    handler: async ({ job_id }: { job_id?: string }): Promise<ToolResult> => {
      if (job_id) {
        const job = getJob(job_id);
        return job ? ok(JSON.stringify(job, null, 2)) : fail(`Böyle bir iş yok: ${job_id}`);
      }
      const summary = listJobs()
        .slice(0, 20)
        .map(({ id, workerId, status, task }) => ({ id, workerId, status, task: task.slice(0, 100) }));
      return ok(JSON.stringify(summary, null, 2));
    },
  },
] as const;

/** MCP sunucusunun adı: araçlar Claude Code içinde mcp__scriptorium__* olarak görünür */
export const WORKER_SERVER_NAME = "scriptorium";

/** Scriptorium'un kendi Claude oturumları için SDK içi sunucu */
export function createWorkerServer(ctx: ToolCtx) {
  return createSdkMcpServer({
    name: WORKER_SERVER_NAME,
    version: "0.2.0",
    instructions: WORKER_INSTRUCTIONS,
    tools: WORKER_TOOLS.map((t) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tool(t.name, t.description, t.schema, (args: any) => t.handler(args, ctx), { alwaysLoad: true }),
    ),
  });
}
