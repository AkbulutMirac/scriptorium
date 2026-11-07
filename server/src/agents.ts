import { copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SERVER_ROOT } from "./config.js";

const WorkerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "id sadece küçük harf, rakam ve tire içerebilir"),
  name: z.string().min(1),
  provider: z.enum(["deepseek", "ollama"]),
  model: z.string().min(1),
  color: z.string().default("#888780"),
  description: z.string().default(""),
  /** true ise veri bilgisayardan çıkmaz */
  local: z.boolean().default(false),
});

const AgentsFileSchema = z.object({ workers: z.array(WorkerSchema) });

export type Worker = z.infer<typeof WorkerSchema>;

const AGENTS_PATH = path.join(SERVER_ROOT, "agents.json");
const EXAMPLE_PATH = path.join(SERVER_ROOT, "agents.example.json");

/** agents.json'ı okur. Yoksa örnek dosyadan oluşturur. Her çağrıda dosyadan okunur, böylece arayüzden eklenen işçi anında görünür. */
export async function loadWorkers(): Promise<Worker[]> {
  if (!existsSync(AGENTS_PATH)) await copyFile(EXAMPLE_PATH, AGENTS_PATH);
  const raw = JSON.parse(await readFile(AGENTS_PATH, "utf8"));
  return AgentsFileSchema.parse(raw).workers;
}

export async function saveWorkers(workers: Worker[]): Promise<void> {
  const data = AgentsFileSchema.parse({ workers });
  await writeFile(AGENTS_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function findWorker(id: string): Promise<Worker | undefined> {
  return (await loadWorkers()).find((w) => w.id === id);
}
