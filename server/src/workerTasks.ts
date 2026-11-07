import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Worker } from "./agents.js";
import { reportActivity } from "./events.js";
import { chat } from "./llm.js";

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

/** Claude'un devrettiği bir işi işçiye yaptırır. 3D kütüphane için durum olayları yayar. */
export async function runWorkerTask(args: {
  worker: Worker;
  task: string;
  files?: string[];
  cwd: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { worker, task, files, cwd, signal } = args;
  reportActivity({ agentId: worker.id, status: "working", task, by: "claude" });
  try {
    const fileText = files?.length ? await readProjectFiles(cwd, files) : "";
    const userContent = fileText ? `${task}\n\n## Dosyalar\n\n${fileText}` : task;
    const { content: answer } = await chat(
      worker,
      [
        { role: "system", content: WORKER_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      { signal },
    );
    reportActivity({ agentId: worker.id, status: "idle" });
    return answer || "(işçi boş cevap döndürdü)";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportActivity({ agentId: worker.id, status: "error", error: message });
    throw new Error(`${worker.name} hata verdi: ${message}`);
  }
}
