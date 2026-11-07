import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { truncate } from "../../lib/format";
import { ACCENTS, useTheme } from "../../lib/theme";
import { actions, CLAUDE_ID, useApp } from "../../store";
import { AgentFigure } from "./AgentFigure";
import { anchors, labelEls, useHovered } from "./labels";
import { claudePose, computePlacements, type Pose } from "./placement";
import { CLAUDE_STATION, ROOM_BACK_Z, ROOM_HALF_X, roomFrontZ, workstations } from "./layout";
import { ComputerDesk, Lounge, OfficeChair, palette, Room } from "./Office";

/** Ortografik kamerayı odanın tamamı görünecek şekilde yakınlaştırır */
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

/** Ortadaki izometrik ofis-kütüphane: Claude arkada baş masada, işçiler sıra sıra, boştakiler dinlenme köşesinde */
export function LibraryScene() {
  const workers = useApp((s) => s.workers);
  const activity = useApp((s) => s.activity);
  const selected = useApp((s) => s.selected);
  const isDark = useTheme((s) => s.isDark);
  const pixel = useTheme((s) => s.pixel);
  const accentHex = useTheme((s) => ACCENTS[s.accent].hex);

  const stations = useMemo(() => workstations(workers.length), [workers.length]);
  const frontZ = roomFrontZ(workers.length);
  const centerZ = (frontZ + ROOM_BACK_Z) / 2;
  const p = palette(isDark);
  const bg = isDark ? "#15121b" : "#f1e7d8";

  const placements = useMemo(() => computePlacements(workers, activity, stations), [workers, activity, stations]);

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

      {/* Baş yazıcı */}
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

      {/* İşçiler */}
      {workers.map((w, i) => {
        const st = stations[i];
        const { pose, seat } = placements[i];
        return (
          <group key={w.id}>
            <ComputerDesk position={st.desk} p={p} screenOn={pose === "working"} accentHex={w.color} isDark={isDark} />
            <OfficeChair position={[st.seat.pos[0], 0, st.seat.pos[2] - 0.15]} color={isDark ? "#3a4258" : "#556080"} />
            <AgentFigure
              id={w.id}
              name={w.name}
              color={w.color}
              pose={pose}
              seat={seat}
              selected={selected === w.id}
              accentHex={accentHex}
              onSelect={() => actions.selectAgent(w.id)}
            />
          </group>
        );
      })}

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
        { id: CLAUDE_ID, name: "Claude", pose: cPose, task: claude?.task, error: claude?.error, always: true },
        ...workers.map((w, i) => ({ id: w.id, name: w.name, pose: placements[i].pose, task: activity[w.id]?.task, error: activity[w.id]?.error })),
      ]}
      selected={selected}
    />
    </>
  );
}

/** Her karede karakterlerin baş üstü noktalarını ekran koordinatına çevirip etiketleri taşır */
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

type LabelItem = { id: string; name: string; pose: Pose; task?: string; error?: string; always?: boolean };

/** Sahnenin üstündeki etiket katmanı: ad (seçili/üzerine gelinen/Claude), görev ya da hata baloncuğu, uyku "z"si */
function SceneLabels({ items, selected }: { items: LabelItem[]; selected: string }) {
  const hovered = useHovered((s) => s.id);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      {items.map((it) => {
        const tag = it.pose === "working" ? truncate(it.task ?? "Çalışıyor", 46) : it.pose === "error" ? `⚠ ${truncate(it.error ?? "Hata", 46)}` : null;
        const showName = !tag && (it.always || selected === it.id || hovered === it.id);
        return (
          <div
            key={it.id}
            ref={(el) => {
              if (el) labelEls.set(it.id, el);
              else labelEls.delete(it.id);
            }}
            className="absolute left-0 top-0"
            style={{ visibility: "hidden" }}
          >
            <div className="agent-tags">
              {tag && (
                <div className={`agent-bubble ${it.pose === "error" ? "error" : ""}`}>
                  <b>{it.name}</b> · {tag}
                </div>
              )}
              <div className={`agent-label ${showName ? "" : "is-hidden"}`}>{it.name}</div>
              {it.pose === "sleeping" && <span className="zzz">z</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
