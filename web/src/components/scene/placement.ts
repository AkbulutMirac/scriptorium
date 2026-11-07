import type { AgentActivity, WorkerInfo } from "../../protocol";
import { LOUNGE_SEATS, type Seat, type Workstation } from "./layout";

/** working: masada yazıyor · reading: kitap okuyor · sleeping: masada uyukluyor · error: hata */
export type Pose = "working" | "reading" | "sleeping" | "error";

/** Kim nerede: çalışanlar masasında, boştakiler sırayla dinlenme köşesinde (yer kalmazsa masada uyukluyor) */
export function computePlacements(workers: WorkerInfo[], activity: Record<string, AgentActivity>, stations: Workstation[]): { pose: Pose; seat: Seat }[] {
  let lounge = 0;
  return workers.map((w, i) => {
    const status = activity[w.id]?.status ?? "idle";
    if (status === "working") return { pose: "working", seat: stations[i].seat };
    if (status === "error") return { pose: "error", seat: stations[i].seat };
    if (lounge < LOUNGE_SEATS.length) return { pose: "reading", seat: LOUNGE_SEATS[lounge++] };
    return { pose: "sleeping", seat: stations[i].seat };
  });
}

/** Claude hep baş masasında: boştayken orada kitap okur */
export function claudePose(a?: AgentActivity): Pose {
  return a?.status === "working" ? "working" : a?.status === "error" ? "error" : "reading";
}
