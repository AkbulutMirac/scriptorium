import type { CopyState } from "../../lib/workerCopies";
import type { AgentActivity, WorkerInfo, WorkerRequest } from "../../protocol";
import { DESKS_PER_ROW, LOUNGE_SEATS, SEAT_HEIGHT, type Seat, type Vec3, type Workstation } from "./layout";

/** working: typing at the desk · reading: reading a book · sleeping: dozing at the desk · error: error · leaving: done, leaving */
export type Pose = "working" | "reading" | "sleeping" | "error" | "leaving";

/** A worker character on stage: the main worker (copy 1) or a copy for another job arriving at the same time */
export type WorkerFigure = {
  /** "deepseek" or "deepseek#2" */
  key: string;
  worker: WorkerInfo;
  copy: number;
  pose: Pose;
  seat: Seat;
  /** Where the copy enters the room (none for the main worker) */
  spawn?: Vec3;
  request?: WorkerRequest;
  /** Jobs queued for this worker */
  queued: number;
};

/** Extra desk count: as many as needed for copies, at least one, filling the last row */
export function hotDeskCount(workerCount: number, copies: CopyState): number {
  const needed = Math.max(0, ...Object.values(copies.copies).map((c) => c.desk + 1));
  const total = Math.ceil((workerCount + Math.max(1, needed)) / DESKS_PER_ROW) * DESKS_PER_ROW;
  return total - workerCount;
}

/**
 * Who is where: the main worker with a job at their own desk, copies at extra desks; idle ones in turn
 * in the lounge corner (dozing at their desk if no room). Copies enter and exit from the front of the room.
 * `workers` are the residents with a desk of their own; `all` also has the visitors (Claude's subagents).
 */
export function computeFigures(
  workers: WorkerInfo[],
  all: WorkerInfo[],
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
    const worker = all.find((w) => w.id === c.workerId);
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

/** Claude is always at the head desk: reads a book there when idle */
export function claudePose(a?: AgentActivity): Pose {
  return a?.status === "working" ? "working" : a?.status === "error" ? "error" : "reading";
}
