import type { WorkerRequest } from "../protocol";

/**
 * When multiple jobs arrive for the same worker at once (from different Claude sessions or parallel
 * calls), a separate worker copy is drawn in the 3D office for each job. The first job goes to the original worker,
 * the others to copies sitting at extra desks. Assignment is permanent: when one job finishes, the others don't swap places.
 */
export type WorkerCopy = {
  workerId: string;
  /** 2, 3, … (1 is the original worker) */
  copy: number;
  /** Extra desk index */
  desk: number;
  requestId?: string;
  /** Job finished, leaving the room */
  leavingAt?: number;
};

export type CopyState = {
  /** Worker id → job done by the original worker */
  base: Record<string, string | undefined>;
  /** "deepseek#2" → copy */
  copies: Record<string, WorkerCopy>;
};

export const LEAVE_MS = 3200;

/**
 * visitors: workers with no desk of their own (Claude's subagents). Every job of theirs walks in through the
 * door as a copy and leaves when done.
 */
export function assignCopies(prev: CopyState, requests: WorkerRequest[], now: number, visitors: Set<string> = new Set()): CopyState {
  const active = new Set(requests.filter((r) => r.status !== "queued").map((r) => r.id));
  const base: CopyState["base"] = {};
  const copies: CopyState["copies"] = {};
  const assigned = new Set<string>();

  for (const [workerId, reqId] of Object.entries(prev.base)) {
    // A visitor placed before the worker list arrived moves to a visitor desk
    if (reqId && active.has(reqId) && !visitors.has(workerId)) {
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
    const visitor = visitors.has(r.workerId);
    if (!visitor && !base[r.workerId]) {
      base[r.workerId] = r.id;
      continue;
    }
    let n = visitor ? 1 : 2;
    while (copies[`${r.workerId}#${n}`]) n++;
    const busyDesks = new Set(Object.values(copies).map((c) => c.desk));
    let desk = 0;
    while (busyDesks.has(desk)) desk++;
    copies[`${r.workerId}#${n}`] = { workerId: r.workerId, copy: n, desk, requestId: r.id };
  }
  return { base, copies };
}
