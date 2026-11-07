import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Worker } from "./agents.js";
import { chat } from "./llm.js";
import type { WorkerCaller } from "./protocol.js";
import { withWorkerSlot } from "./requests.js";

/** İşçiye gönderilen dosyaların toplam karakter sınırı (maliyet güvenliği). */
const MAX_FILE_CHARS = 200_000;

const WORKER_SYSTEM_PROMPT =
  "Sen bir yazılım ekibinde işçi modelsin. Görevi patron (Claude) veriyor ve cevabını o kontrol edecek. " +
  "Sadece istenen işi yap, kısa ve net cevap ver. Kod istendiyse tam ve çalışır kod yaz, hangi dosyaya ait olduğunu belirt.";

/** Dosyaları proje klasörünün dışına çıkmadan okur ve tek bir metinde birleştirir. */
async function readProjectFiles(cwd: string, files: string[]): Promise<string> {
  let total = 0;
  const parts: string[] = [];
  for (const file of files) {
    const abs = path.resolve(cwd, file);
    const rel = path.relative(cwd, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Proje klasörü dışındaki dosya gönderilemez: ${file}`);
    }
    const content = await readFile(abs, "utf8");
    total += content.length;
    if (total > MAX_FILE_CHARS) {
      throw new Error(`Dosyalar çok büyük: toplam sınır ${MAX_FILE_CHARS} karakter.`);
    }
    parts.push(`### ${rel.replaceAll("\\", "/")}\n\`\`\`\n${content}\n\`\`\``);
  }
  return parts.join("\n\n");
}

/** Claude'un devrettiği bir işi işçiye yaptırır. İstek 3D ofiste ayrı bir işçi kopyası olarak görünür. */
export async function runWorkerTask(args: {
  worker: Worker;
  task: string;
  files?: string[];
  /** files yollarının göreli olduğu klasör */
  cwd?: string;
  caller: WorkerCaller;
  signal?: AbortSignal;
}): Promise<string> {
  const { worker, task, files, cwd, signal } = args;
  if (files?.length && !cwd) throw new Error("Dosya göndermek için project_dir ver (proje klasörünün tam yolu).");
  return withWorkerSlot(worker, { task, caller: args.caller, signal }, async () => {
    const fileText = files?.length && cwd ? await readProjectFiles(cwd, files) : "";
    const userContent = fileText ? `${task}\n\n## Dosyalar\n\n${fileText}` : task;
    const { content: answer } = await chat(
      worker,
      [
        { role: "system", content: WORKER_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      { signal },
    );
    return answer || "(işçi boş cevap döndürdü)";
  }).catch((err) => {
    throw new Error(`${worker.name} hata verdi: ${err instanceof Error ? err.message : String(err)}`);
  });
}
