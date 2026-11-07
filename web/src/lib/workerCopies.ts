import type { WorkerRequest } from "../protocol";

/**
 * Aynı işçiye aynı anda birden fazla iş gelince (farklı Claude oturumlarından ya da paralel
 * çağrılardan) 3D ofiste her iş için ayrı bir işçi kopyası çizilir. İlk iş asıl işçiye gider,
 * diğerleri ek masalarda oturan kopyalara. Atama kalıcıdır: bir iş bitince diğerleri yer değiştirmez.
 */
export type WorkerCopy = {
  workerId: string;
  /** 2, 3, … (1 asıl işçi) */
  copy: number;
  /** Ek masa sırası */
  desk: number;
  requestId?: string;
  /** İşi bitti, odadan çıkıyor */
  leavingAt?: number;
};

export type CopyState = {
  /** İşçi id'si → asıl işçinin yaptığı iş */
  base: Record<string, string | undefined>;
  /** "deepseek#2" → kopya */
  copies: Record<string, WorkerCopy>;
};

export const LEAVE_MS = 3200;

export function assignCopies(prev: CopyState, requests: WorkerRequest[], now: number): CopyState {
  const active = new Set(requests.filter((r) => r.status !== "queued").map((r) => r.id));
  const base: CopyState["base"] = {};
  const copies: CopyState["copies"] = {};
  const assigned = new Set<string>();

  for (const [workerId, reqId] of Object.entries(prev.base)) {
    if (reqId && active.has(reqId)) {
      base[workerId] = reqId;
      assigned.add(reqId);
    }
  }
  for (const [key, c] of Object.entries(prev.copies)) {
    if (c.leavingAt) {
      if (now - c.leavingAt < LEAVE_MS) copies[key] = c;
    } else if (c.requestId && active.has(c.requestId)) {
      copies[key] = c;
      assigned.add(c.requestId);
    } else {
      copies[key] = { ...c, requestId: undefined, leavingAt: now };
    }
  }

  for (const r of requests) {
    if (r.status === "queued" || assigned.has(r.id)) continue;
    if (!base[r.workerId]) {
      base[r.workerId] = r.id;
      continue;
    }
    let n = 2;
    while (copies[`${r.workerId}#${n}`]) n++;
    const busyDesks = new Set(Object.values(copies).map((c) => c.desk));
    let desk = 0;
    while (busyDesks.has(desk)) desk++;
    copies[`${r.workerId}#${n}`] = { workerId: r.workerId, copy: n, desk, requestId: r.id };
  }
  return { base, copies };
}
