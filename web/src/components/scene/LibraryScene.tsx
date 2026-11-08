import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { ACCENTS, useTheme } from "../../lib/theme";
import type { WorkerRequest } from "../../protocol";
import { actions, CLAUDE_ID, useApp } from "../../store";
import { AgentFigure } from "./AgentFigure";
import { anchors, labelEls, useHovered } from "./labels";
import { claudePose, computeFigures, hotDeskCount, type Pose } from "./placement";
import { CLAUDE_STATION, ROOM_BACK_Z, ROOM_HALF_X, roomFrontZ, workstations } from "./layout";
import { ComputerDesk, Lounge, OfficeChair, palette, Room } from "./Office";

/** Zooms the orthographic camera so the whole room is visible */
function CameraFit({ frontZ }: { frontZ: number }) {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    const span = ROOM_HALF_X * 2 + (frontZ - ROOM_BACK_Z);
    const worldW = span * 0.72;
    const worldH = span * 0.42 + 4.2 * 0.82;
    cam.zoom = Math.min(width / worldW, height / worldH) * 0.98;
    cam.updateProjectionMatrix();
  }, [camera, width, height, frontZ]);
  return null;
}

/**
 * The central isometric office-library: Claude at the head desk in the back, workers in rows, idle ones
 * in the lounge corner. If the same worker gets multiple jobs at once, a copy of each job
 * enters the room and sits at one of the extra desks, leaving when the job is done.
 */
export function LibraryScene() {
  const workers = useApp((s) => s.workers);
  const activity = useApp((s) => s.activity);
  const requests = useApp((s) => s.workerRequests);
  const copies = useApp((s) => s.workerCopies);
  const selected = useApp((s) => s.selected);
  const isDark = useTheme((s) => s.isDark);
  const pixel = useTheme((s) => s.pixel);
  const accentHex = useTheme((s) => ACCENTS[s.accent].hex);

  const hot = hotDeskCount(workers.length, copies);
  const deskCount = workers.length + hot;
  const stations = useMemo(() => workstations(deskCount), [deskCount]);
  const frontZ = roomFrontZ(deskCount);
  const centerZ = (frontZ + ROOM_BACK_Z) / 2;
  const p = palette(isDark);
  const bg = isDark ? "#15121b" : "#f1e7d8";

  const figures = useMemo(() => computeFigures(workers, requests, copies, stations, frontZ), [workers, requests, copies, stations, frontZ]);
  const occupied = new Set(
    Object.values(copies.copies)
      .filter((c) => !c.leavingAt)
      .map((c) => c.desk),
  );

  const claude = activity[CLAUDE_ID];
  const cPose = claudePose(claude);

  return (
    <>
    <Canvas
      key={pixel ? "pixel" : "smooth"}
      orthographic
      shadows
      dpr={pixel ? 0.45 : [1, 2]}
      gl={{ antialias: !pixel }}
      style={{ imageRendering: pixel ? "pixelated" : "auto" }}
      camera={{ position: [18, 18, centerZ + 18], zoom: 40, near: 0.1, far: 200 }}
      onPointerMissed={() => (document.body.style.cursor = "")}
    >
      <color attach="background" args={[bg]} />
      <CameraFit frontZ={frontZ} />

      <ambientLight intensity={isDark ? 0.55 : 0.65} />
      <hemisphereLight args={[isDark ? "#7a72a8" : "#fff4e0", isDark ? "#2a1e16" : "#8a6a4a", isDark ? 0.7 : 0.55]} />
      <directionalLight
        position={[-6, 14, centerZ + 9]}
        intensity={isDark ? 0.75 : 1.25}
        color={isDark ? "#a9b6ff" : "#ffeccc"}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-bias={-0.0008}
      />

      <Room p={p} frontZ={frontZ} isDark={isDark} />
      <Lounge p={p} isDark={isDark} />

      {/* Head printer */}
      <ComputerDesk position={CLAUDE_STATION.desk} p={p} big screenOn={cPose === "working"} accentHex={accentHex} isDark={isDark} />
      <OfficeChair position={[CLAUDE_STATION.seat.pos[0], 0, CLAUDE_STATION.seat.pos[2] - 0.15]} color="#7a3b2e" />
      <AgentFigure
        name="Claude"
        color="#D97757"
        isClaude
        id={CLAUDE_ID}
        pose={cPose}
        seat={CLAUDE_STATION.seat}
        selected={selected === CLAUDE_ID}
        accentHex={accentHex}
        onSelect={() => actions.selectAgent(CLAUDE_ID)}
      />

      {/* Desks: first each worker's own desk, then extra desks for copies */}
      {stations.map((st, i) => {
        const w = workers[i];
        const busyHot = !w && occupied.has(i - workers.length);
        const screenOn = w ? figures[i]?.pose === "working" : busyHot;
        return (
          <group key={`desk-${i}`}>
            <ComputerDesk position={st.desk} p={p} screenOn={screenOn} accentHex={w?.color ?? accentHex} isDark={isDark} />
            <OfficeChair position={[st.seat.pos[0], 0, st.seat.pos[2] - 0.15]} color={isDark ? "#3a4258" : "#556080"} />
          </group>
        );
      })}

      {/* Workers and their copies */}
      {figures.map((f) => (
        <AgentFigure
          key={f.key}
          id={f.key}
          name={f.worker.name}
          color={f.worker.color}
          pose={f.pose}
          seat={f.seat}
          spawn={f.spawn}
          selected={selected === f.worker.id}
          accentHex={accentHex}
          onSelect={() => actions.selectAgent(f.worker.id)}
        />
      ))}

      <OrbitControls
        makeDefault
        target={[0, 0.8, centerZ]}
        enablePan={false}
        minZoom={15}
        maxZoom={160}
        minPolarAngle={0.7}
        maxPolarAngle={1.15}
        minAzimuthAngle={Math.PI / 4 - 0.6}
        maxAzimuthAngle={Math.PI / 4 + 0.6}
      />
      <LabelTracker />
    </Canvas>
    <SceneLabels
      items={[
        { id: CLAUDE_ID, name: "Claude", pose: cPose, claudeTask: claude?.task, error: claude?.error, always: true, queued: 0 },
        ...figures.map((f) => ({
          id: f.key,
          name: f.copy > 1 ? `${f.worker.name} #${f.copy}` : f.worker.name,
          pose: f.pose,
          request: f.request,
          error: f.request?.error,
          queued: f.queued,
        })),
      ]}
      selected={selected}
    />
    </>
  );
}

/** Each frame, projects the characters' overhead anchor points to screen coordinates and moves the labels */
function LabelTracker() {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const [id, obj] of anchors) {
      const el = labelEls.get(id);
      if (!el) continue;
      obj.getWorldPosition(v).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.visibility = Math.abs(v.z) <= 1 ? "visible" : "hidden";
    }
  });
  return null;
}

type LabelItem = {
  id: string;
  name: string;
  pose: Pose;
  /** The job the worker is working on */
  request?: WorkerRequest;
  /** Claude's current job */
  claudeTask?: string;
  error?: string;
  queued: number;
  always?: boolean;
};

/** "2 min 05 s" — updates every second (only while the card is open) */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <>{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`}</>;
}

function callerText(r: WorkerRequest) {
  if (r.caller.kind === "user") return "For you (direct chat)";
  return r.caller.label ? `Claude · ${r.caller.label} for` : "For Claude";
}

/** Card that opens on hover: which job, for whom, and for how long it has been running */
function AgentCard({ it }: { it: LabelItem }) {
  const r = it.request;
  const working = it.pose === "working";
  return (
    <div className={`agent-card ${it.pose === "error" ? "error" : ""}`}>
      <div className="agent-card-title">{it.name}</div>
      {r ? (
        <>
          <div className="agent-card-caller">{callerText(r)}</div>
          <div className="agent-card-task">{r.task}</div>
          {it.pose === "error" ? (
            <div className="agent-card-error">⚠ {it.error ?? "Error"}</div>
          ) : (
            working && r.startedAt && (
              <div className="agent-card-meta">
                <Elapsed since={r.startedAt} />
                {" working"}
              </div>
            )
          )}
        </>
      ) : it.claudeTask && working ? (
        <div className="agent-card-task">{it.claudeTask}</div>
      ) : it.pose === "error" ? (
        <div className="agent-card-error">⚠ {it.error ?? "Error"}</div>
      ) : (
        <div className="agent-card-meta">{it.pose === "leaving" ? "Done, leaving" : "Idle"}</div>
      )}
      {it.queued > 0 && <div className="agent-card-meta">{it.queued} jobs waiting in queue</div>}
    </div>
  );
}

/**
 * Label layer above the scene. Names of working and erroring characters are always visible;
 * on hover, a card opens showing which job is being done for whom.
 */
function SceneLabels({ items, selected }: { items: LabelItem[]; selected: string }) {
  const hovered = useHovered((s) => s.id);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      {items.map((it) => {
        const isHovered = hovered === it.id;
        const busy = it.pose === "working" || it.pose === "error";
        const showName = it.always || busy || selected === it.id || selected === it.id.split("#")[0];
        const caller = it.request?.caller.kind === "user" ? "you" : it.request?.caller.label;
        return (
          <div
            key={it.id}
            ref={(el) => {
              if (el) labelEls.set(it.id, el);
              else labelEls.delete(it.id);
            }}
            className="absolute left-0 top-0"
            style={{ visibility: "hidden", zIndex: isHovered ? 2 : busy ? 1 : 0 }}
          >
            <div className="agent-tags">
              {isHovered ? (
                <AgentCard it={it} />
              ) : (
                <div className={`agent-label ${showName ? "" : "is-hidden"} ${it.pose === "working" ? "working" : ""} ${it.pose === "error" ? "error" : ""}`}>
                  {it.pose === "error" && "⚠ "}
                  {it.name}
                  {it.pose === "working" && caller && <span className="agent-label-sub"> · {caller}</span>}
                </div>
              )}
              {it.pose === "sleeping" && !isHovered && <span className="zzz">z</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
