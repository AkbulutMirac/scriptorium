import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type * as THREE from "three";
import { ACCENTS, useTheme } from "../../lib/theme";
import { actions, CLAUDE_ID, useApp } from "../../store";
import { AgentFigure, type Pose } from "./AgentFigure";
import { CLAUDE_STATION, LOUNGE_SEATS, ROOM_BACK_Z, ROOM_HALF_X, roomFrontZ, workstations, type Seat } from "./layout";
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

  // Kim nerede: çalışanlar masasında, boştakiler sırayla dinlenme köşesinde (yer kalmazsa masada uyukluyor)
  const placements = useMemo(() => {
    let lounge = 0;
    return workers.map((w, i) => {
      const status = activity[w.id]?.status ?? "idle";
      let pose: Pose;
      let seat: Seat;
      if (status === "working") [pose, seat] = ["working", stations[i].seat];
      else if (status === "error") [pose, seat] = ["error", stations[i].seat];
      else if (lounge < LOUNGE_SEATS.length) [pose, seat] = ["reading", LOUNGE_SEATS[lounge++]];
      else [pose, seat] = ["sleeping", stations[i].seat];
      return { pose, seat };
    });
  }, [workers, activity, stations]);

  const claude = activity[CLAUDE_ID];
  const claudePose: Pose = claude?.status === "working" ? "working" : claude?.status === "error" ? "error" : "reading";

  return (
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
      <ComputerDesk position={CLAUDE_STATION.desk} p={p} big screenOn={claudePose === "working"} accentHex={accentHex} isDark={isDark} />
      <OfficeChair position={[CLAUDE_STATION.seat.pos[0], 0, CLAUDE_STATION.seat.pos[2] - 0.15]} color="#7a3b2e" />
      <AgentFigure
        name="Claude"
        color="#D97757"
        isClaude
        pose={claudePose}
        seat={CLAUDE_STATION.seat}
        task={claude?.task}
        error={claude?.error}
        selected={selected === CLAUDE_ID}
        accentHex={accentHex}
        onSelect={() => actions.selectAgent(CLAUDE_ID)}
      />

      {/* İşçiler */}
      {workers.map((w, i) => {
        const st = stations[i];
        const { pose, seat } = placements[i];
        const a = activity[w.id];
        return (
          <group key={w.id}>
            <ComputerDesk position={st.desk} p={p} screenOn={pose === "working"} accentHex={w.color} isDark={isDark} />
            <OfficeChair position={[st.seat.pos[0], 0, st.seat.pos[2] - 0.15]} color={isDark ? "#3a4258" : "#556080"} />
            <AgentFigure
              name={w.name}
              color={w.color}
              pose={pose}
              seat={seat}
              task={a?.task}
              error={a?.error}
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
    </Canvas>
  );
}
