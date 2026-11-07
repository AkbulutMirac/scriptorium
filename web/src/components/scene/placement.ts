import type { CopyState } from "../../lib/workerCopies";
import type { AgentActivity, WorkerInfo, WorkerRequest } from "../../protocol";
import { DESKS_PER_ROW, LOUNGE_SEATS, SEAT_HEIGHT, type Seat, type Vec3, type Workstation } from "./layout";

/** working: masada yazıyor · reading: kitap okuyor · sleeping: masada uyukluyor · error: hata · leaving: işi bitti, çıkıyor */
export type Pose = "working" | "reading" | "sleeping" | "error" | "leaving";

/** Sahnedeki bir işçi karakteri: asıl işçi (copy 1) ya da aynı anda gelen başka bir iş için kopyası */
export type WorkerFigure = {
  /** "deepseek" ya da "deepseek#2" */
  key: string;
  worker: WorkerInfo;
  copy: number;
  pose: Pose;
  seat: Seat;
  /** Kopyanın odaya girdiği yer (asıl işçi için yok) */
  spawn?: Vec3;
  request?: WorkerRequest;
  /** Bu işçinin sırada bekleyen işleri */
  queued: number;
};

/** Ek masa sayısı: kopyalar için gerektiği kadar, en az bir tane, son sırayı dolduracak şekilde */
export function hotDeskCount(workerCount: number, copies: CopyState): number {
  const needed = Math.max(0, ...Object.values(copies.copies).map((c) => c.desk + 1));
  const total = Math.ceil((workerCount + Math.max(1, needed)) / DESKS_PER_ROW) * DESKS_PER_ROW;
  return total - workerCount;
}

/**
 * Kim nerede: işi olan asıl işçi kendi masasında, kopyalar ek masalarda; boştakiler sırayla
 * dinlenme köşesinde (yer kalmazsa masasında uyukluyor). Kopyalar odanın ön tarafından girip çıkar.
 */
export function computeFigures(
  workers: WorkerInfo[],
  requests: WorkerRequest[],
  copies: CopyState,
  stations: Workstation[],
  frontZ: number,
): WorkerFigure[] {
  const byId = new Map(requests.map((r) => [r.id, r]));
  const queuedOf = (id: string) => requests.filter((r) => r.workerId === id && r.status === "queued").length;
  let lounge = 0;

  const figures: WorkerFigure[] = workers.map((w, i) => {
    const own = stations[i].seat;
    const reqId = copies.base[w.id];
    const request = reqId ? byId.get(reqId) : undefined;
    const base = { key: w.id, worker: w, copy: 1, request, queued: queuedOf(w.id) };
    if (request?.status === "running") return { ...base, pose: "working", seat: own };
    if (request?.status === "error") return { ...base, pose: "error", seat: own };
    if (lounge < LOUNGE_SEATS.length) return { ...base, pose: "reading", seat: LOUNGE_SEATS[lounge++] };
    return { ...base, pose: "sleeping", seat: own };
  });

  for (const [key, c] of Object.entries(copies.copies)) {
    const worker = workers.find((w) => w.id === c.workerId);
    const desk = stations[workers.length + c.desk];
    if (!worker || !desk) continue;
    const door: Vec3 = [desk.seat.pos[0], SEAT_HEIGHT, frontZ + 1.4];
    const request = c.requestId ? byId.get(c.requestId) : undefined;
    const pose: Pose = c.leavingAt ? "leaving" : request?.status === "error" ? "error" : "working";
    figures.push({
      key,
      worker,
      copy: c.copy,
      pose,
      seat: c.leavingAt ? { pos: door, rot: 0 } : desk.seat,
      spawn: door,
      request,
      queued: 0,
    });
  }
  return figures;
}

/** Claude hep baş masasında: boştayken orada kitap okur */
export function claudePose(a?: AgentActivity): Pose {
  return a?.status === "working" ? "working" : a?.status === "error" ? "error" : "reading";
}
