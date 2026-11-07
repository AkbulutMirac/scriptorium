import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ROOM_BACK_Z, ROOM_HALF_X, seeded, type Vec3 } from "./layout";

export type Palette = {
  floorA: string;
  floorB: string;
  wall: string;
  wallTrim: string;
  wood: string;
  woodDark: string;
  fabric: string;
  rug: string;
  metal: string;
};

export function palette(isDark: boolean): Palette {
  return isDark
    ? { floorA: "#76543b", floorB: "#684a33", wall: "#4a4160", wallTrim: "#352e45", wood: "#6b4a32", woodDark: "#4a3222", fabric: "#4f6b6a", rug: "#6b3b3b", metal: "#3c3f4a" }
    : { floorA: "#c48d5b", floorB: "#b47e4e", wall: "#e9d9bf", wallTrim: "#b9946b", wood: "#9a6a43", woodDark: "#734c2f", fabric: "#6f9a8f", rug: "#b5523f", metal: "#5b616e" };
}

const BOOK_COLORS = ["#8c3b2e", "#2f4f6f", "#3e6b48", "#a8792b", "#5b3a6b", "#7a2e3b", "#2b5d5c", "#c2a15a", "#4a4a6a", "#9b5b33", "#d4b483"];

// ─── Oda ───────────────────────────────────────────────────────────────────────

/** Parke zemin dokusu (piksel görünümde de net dursun diye en yakın komşu filtreli) */
function useFloorTexture(a: string, b: string, depth: number) {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext("2d")!;
    const rand = seeded(42);
    for (let row = 0; row < 8; row++) {
      let x = -Math.floor(rand() * 40);
      while (x < 128) {
        const len = 30 + Math.floor(rand() * 40);
        ctx.fillStyle = rand() > 0.5 ? a : b;
        ctx.fillRect(x, row * 16, len, 16);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(x, row * 16, 1, 16);
        x += len;
      }
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(0, row * 16 + 15, 128, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set((ROOM_HALF_X * 2) / 4, (depth - ROOM_BACK_Z) / 4);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [a, b, depth]);
}

export function Room({ p, frontZ, isDark }: { p: Palette; frontZ: number; isDark: boolean }) {
  const depth = frontZ - ROOM_BACK_Z;
  const centerZ = (frontZ + ROOM_BACK_Z) / 2;
  const floorTex = useFloorTexture(p.floorA, p.floorB, frontZ);
  const wallH = 4.2;

  return (
    <group>
      {/* Zemin (kalın döşeme: izometrik kesitte kenarı görünür) */}
      <mesh position={[0, -0.15, centerZ]} receiveShadow>
        <boxGeometry args={[ROOM_HALF_X * 2, 0.3, depth]} />
        <meshStandardMaterial map={floorTex} roughness={0.85} />
      </mesh>

      {/* Arka ve sol duvar */}
      <mesh position={[0, wallH / 2, ROOM_BACK_Z - 0.12]} receiveShadow castShadow>
        <boxGeometry args={[ROOM_HALF_X * 2 + 0.25, wallH, 0.25]} />
        <meshStandardMaterial color={p.wall} roughness={0.95} />
      </mesh>
      <mesh position={[-ROOM_HALF_X - 0.12, wallH / 2, centerZ]} receiveShadow castShadow>
        <boxGeometry args={[0.25, wallH, depth]} />
        <meshStandardMaterial color={p.wall} roughness={0.95} />
      </mesh>
      {/* Süpürgelikler */}
      <mesh position={[0, 0.1, ROOM_BACK_Z + 0.03]}>
        <boxGeometry args={[ROOM_HALF_X * 2, 0.2, 0.06]} />
        <meshStandardMaterial color={p.wallTrim} />
      </mesh>
      <mesh position={[-ROOM_HALF_X + 0.03, 0.1, centerZ]}>
        <boxGeometry args={[0.06, 0.2, depth]} />
        <meshStandardMaterial color={p.wallTrim} />
      </mesh>

      {/* Sol duvarda pencereler */}
      <Window position={[-ROOM_HALF_X + 0.02, 2.2, -2.2]} isDark={isDark} />
      <Window position={[-ROOM_HALF_X + 0.02, 2.2, 2.4]} isDark={isDark} />
      <Bookshelf position={[-ROOM_HALF_X + 0.35, 0, 0.1]} rotation={Math.PI / 2} width={2.2} seed={21} wood={p.wood} />

      {/* Arka duvar rafları */}
      {[-6.2, -4.3, -1.7, 0.2].map((x, i) => (
        <Bookshelf key={x} position={[x, 0, ROOM_BACK_Z + 0.35]} width={1.8} seed={i + 1} wood={p.wood} />
      ))}
      <TaskBoard position={[5.3, 2.5, ROOM_BACK_Z + 0.05]} />
      <WallClock position={[2.1, 3.1, ROOM_BACK_Z + 0.05]} />

      {/* Meşaleler: karanlıkta odayı sıcak, titreyen bir ışıkla aydınlatır */}
      <Torch position={[-3.0, 2.55, ROOM_BACK_Z + 0.02]} isDark={isDark} seed={1} />
      <Torch position={[1.5, 2.45, ROOM_BACK_Z + 0.02]} isDark={isDark} seed={2} />
      <Torch position={[7.15, 2.45, ROOM_BACK_Z + 0.02]} isDark={isDark} seed={3} />
      <Torch position={[-ROOM_HALF_X + 0.02, 2.45, -4.5]} rotation={Math.PI / 2} isDark={isDark} seed={4} />
      <Torch position={[-ROOM_HALF_X + 0.02, 2.45, 4.3]} rotation={Math.PI / 2} isDark={isDark} seed={5} />
      <Brazier position={[ROOM_HALF_X - 0.6, 0, frontZ - 0.7]} isDark={isDark} />

      <Plant position={[-6.9, 0, frontZ - 0.8]} size={1.1} />
      <Plant position={[2.0, 0, ROOM_BACK_Z + 0.6]} size={0.9} />
      <Plant position={[7.0, 0, -0.4]} size={1} />
      <WaterCooler position={[6.8, 0, 1.4]} />
    </group>
  );
}

/** Alevin titremesi: birkaç farklı hızda sinüsün toplamı, her meşalede farklı faz */
function flicker(t: number, seed: number) {
  return 0.82 + Math.sin(t * 11.3 + seed * 1.7) * 0.07 + Math.sin(t * 17.9 + seed * 3.1) * 0.06 + Math.sin(t * 5.1 + seed) * 0.05;
}

/** Duvar meşalesi: braket, kâse, iki katmanlı alev ve turuncu titreyen ışık */
function Torch({ position, rotation = 0, isDark, seed }: { position: Vec3; rotation?: number; isDark: boolean; seed: number }) {
  const light = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Group>(null);
  const base = isDark ? 4.2 : 0.9;

  useFrame((state) => {
    const f = flicker(state.clock.elapsedTime, seed);
    if (light.current) light.current.intensity = base * f;
    if (flame.current) {
      flame.current.scale.set(1, 0.85 + (f - 0.82) * 2.2, 1);
      flame.current.rotation.z = Math.sin(state.clock.elapsedTime * 6 + seed) * 0.08;
    }
  });

  return (
    <group position={position} rotation-y={rotation}>
      {/* Duvar plakası ve kol */}
      <mesh position={[0, 0, 0.03]}>
        <boxGeometry args={[0.16, 0.3, 0.05]} />
        <meshStandardMaterial color="#3a2a20" roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.02, 0.17]} rotation-x={-0.5}>
        <cylinderGeometry args={[0.025, 0.035, 0.32, 8]} />
        <meshStandardMaterial color="#4a3426" roughness={0.6} metalness={0.4} />
      </mesh>
      {/* Kâse */}
      <mesh position={[0, 0.17, 0.27]}>
        <cylinderGeometry args={[0.09, 0.05, 0.1, 10]} />
        <meshStandardMaterial color="#2b201a" roughness={0.5} metalness={0.5} />
      </mesh>
      {/* Alev */}
      <group ref={flame} position={[0, 0.24, 0.27]}>
        <mesh position-y={0.1}>
          <coneGeometry args={[0.075, 0.26, 10]} />
          <meshBasicMaterial color="#ff7a1a" transparent opacity={0.9} />
        </mesh>
        <mesh position-y={0.06}>
          <coneGeometry args={[0.04, 0.15, 8]} />
          <meshBasicMaterial color="#ffd36b" />
        </mesh>
      </group>
      <pointLight ref={light} position={[0, 0.4, 0.55]} color="#ff9a3c" intensity={base} distance={7.5} decay={1.8} />
    </group>
  );
}

/** Köşede ayaklı mangal */
function Brazier({ position, isDark }: { position: Vec3; isDark: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Group>(null);
  const base = isDark ? 5.5 : 1.1;
  useFrame((state) => {
    const f = flicker(state.clock.elapsedTime, 9);
    if (light.current) light.current.intensity = base * f;
    if (flame.current) flame.current.scale.set(1, 0.85 + (f - 0.82) * 2.4, 1);
  });
  return (
    <group position={position}>
      {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((a) => (
        <mesh key={a} position={[Math.cos(a) * 0.18, 0.4, Math.sin(a) * 0.18]} rotation={[Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25]}>
          <cylinderGeometry args={[0.025, 0.03, 0.85, 6]} />
          <meshStandardMaterial color="#2b201a" roughness={0.5} metalness={0.5} />
        </mesh>
      ))}
      <mesh position-y={0.86} castShadow>
        <cylinderGeometry args={[0.3, 0.18, 0.18, 14]} />
        <meshStandardMaterial color="#3a2a20" roughness={0.5} metalness={0.5} />
      </mesh>
      <group ref={flame} position-y={0.95}>
        {[
          [0, 0, 0.13, 0.42, "#ff7a1a"],
          [0.09, 0.03, 0.07, 0.28, "#ff9a3c"],
          [-0.08, -0.04, 0.07, 0.3, "#ff9a3c"],
          [0, 0, 0.07, 0.24, "#ffd36b"],
        ].map(([x, z, r, h, c], i) => (
          <mesh key={i} position={[x as number, (h as number) / 2, z as number]}>
            <coneGeometry args={[r as number, h as number, 9]} />
            <meshBasicMaterial color={c as string} transparent opacity={0.92} />
          </mesh>
        ))}
      </group>
      <pointLight ref={light} position={[0, 1.4, 0]} color="#ff9a3c" intensity={base} distance={8} decay={1.8} />
    </group>
  );
}

function Window({ position, isDark }: { position: Vec3; isDark: boolean }) {
  const glass = isDark ? "#22305a" : "#cfe8ff";
  return (
    <group position={position} rotation-y={Math.PI / 2}>
      <mesh>
        <boxGeometry args={[1.9, 1.6, 0.08]} />
        <meshStandardMaterial color="#f2e8d8" roughness={0.7} />
      </mesh>
      {[-0.45, 0.45].map((x) =>
        [-0.37, 0.37].map((y) => (
          <mesh key={`${x}${y}`} position={[x, y, 0.05]}>
            <planeGeometry args={[0.82, 0.66]} />
            <meshStandardMaterial color={glass} emissive={glass} emissiveIntensity={isDark ? 0.35 : 0.6} roughness={0.2} />
          </mesh>
        )),
      )}
      {isDark &&
        [
          [-0.6, 0.5],
          [0.3, 0.2],
          [0.65, 0.58],
          [-0.2, -0.3],
        ].map(([x, y], i) => (
          <mesh key={i} position={[x, y, 0.06]}>
            <planeGeometry args={[0.04, 0.04]} />
            <meshBasicMaterial color="#fff6c8" />
          </mesh>
        ))}
    </group>
  );
}

export function Bookshelf({ position, rotation = 0, width, seed, wood }: { position: Vec3; rotation?: number; width: number; seed: number; wood: string }) {
  const height = 3.0;
  const shelves = 4;
  const ref = useRef<THREE.InstancedMesh>(null);

  const books = useMemo(() => {
    const rand = seeded(seed * 7919);
    const list: { x: number; y: number; w: number; h: number; tilt: number; color: string }[] = [];
    for (let s = 0; s < shelves; s++) {
      const baseY = 0.18 + s * (height / shelves);
      let x = -width / 2 + 0.1;
      while (x < width / 2 - 0.15) {
        const w = 0.07 + rand() * 0.06;
        const h = 0.4 + rand() * 0.25;
        if (rand() < 0.08) {
          x += 0.16;
          continue;
        }
        list.push({ x: x + w / 2, y: baseY + h / 2, w, h, tilt: rand() < 0.07 ? 0.25 : 0, color: BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)] });
        x += w + 0.01;
      }
    }
    return list;
  }, [seed, width]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    books.forEach((b, i) => {
      q.setFromEuler(new THREE.Euler(0, 0, b.tilt));
      m.compose(new THREE.Vector3(b.x, b.y, 0), q, new THREE.Vector3(b.w, b.h, 0.36));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(b.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [books]);

  return (
    <group position={position} rotation-y={rotation}>
      <mesh position={[0, height / 2, -0.22]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.16, height + 0.2, 0.06]} />
        <meshStandardMaterial color={wood} roughness={0.8} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (width / 2 + 0.04), height / 2, 0]} castShadow>
          <boxGeometry args={[0.08, height + 0.2, 0.5]} />
          <meshStandardMaterial color={wood} roughness={0.8} />
        </mesh>
      ))}
      {Array.from({ length: shelves + 1 }, (_, s) => (
        <mesh key={s} position={[0, 0.14 + s * (height / shelves), 0]} castShadow receiveShadow>
          <boxGeometry args={[width, 0.05, 0.5]} />
          <meshStandardMaterial color={wood} roughness={0.8} />
        </mesh>
      ))}
      <instancedMesh ref={ref} args={[undefined, undefined, books.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.7} />
      </instancedMesh>
    </group>
  );
}

/** Duvardaki görev panosu: yapışkan notlar ve küçük bir grafik */
function TaskBoard({ position }: { position: Vec3 }) {
  const notes: [number, number, string][] = [
    [-0.75, 0.35, "#ffe08a"],
    [-0.35, 0.4, "#a7e3b5"],
    [-0.7, -0.15, "#ffb3a7"],
    [-0.3, -0.1, "#a9d4ff"],
  ];
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[2.3, 1.4, 0.06]} />
        <meshStandardMaterial color="#6b4a32" />
      </mesh>
      <mesh position-z={0.035}>
        <planeGeometry args={[2.15, 1.25]} />
        <meshStandardMaterial color="#f7f3ea" />
      </mesh>
      {notes.map(([x, y, c], i) => (
        <mesh key={i} position={[x, y, 0.04]} rotation-z={(i % 2 ? 1 : -1) * 0.06}>
          <planeGeometry args={[0.32, 0.32]} />
          <meshStandardMaterial color={c} />
        </mesh>
      ))}
      {[0.25, 0.5, 0.35, 0.7].map((h, i) => (
        <mesh key={i} position={[0.25 + i * 0.2, -0.45 + h / 2, 0.04]}>
          <planeGeometry args={[0.13, h]} />
          <meshStandardMaterial color={["#d97757", "#4d6bfe", "#22a06b", "#e8a23a"][i]} />
        </mesh>
      ))}
      <mesh position={[0.55, 0.32, 0.04]}>
        <circleGeometry args={[0.25, 24, 0, Math.PI * 1.3]} />
        <meshStandardMaterial color="#7f77dd" />
      </mesh>
      <mesh position={[0.55, 0.32, 0.039]}>
        <circleGeometry args={[0.25, 24]} />
        <meshStandardMaterial color="#e8a23a" />
      </mesh>
    </group>
  );
}

function WallClock({ position }: { position: Vec3 }) {
  const hand = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (hand.current) hand.current.rotation.z = -state.clock.elapsedTime * 0.5;
  });
  return (
    <group position={position}>
      <mesh rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.32, 0.32, 0.06, 28]} />
        <meshStandardMaterial color="#f7f3ea" />
      </mesh>
      <mesh ref={hand} position-z={0.04}>
        <boxGeometry args={[0.03, 0.42, 0.01]} />
        <meshStandardMaterial color="#2b2230" />
      </mesh>
    </group>
  );
}

export function Plant({ position, size = 1 }: { position: Vec3; size?: number }) {
  return (
    <group position={position} scale={size}>
      <mesh position-y={0.28} castShadow>
        <cylinderGeometry args={[0.3, 0.23, 0.56, 14]} />
        <meshStandardMaterial color="#c8724a" roughness={0.9} />
      </mesh>
      {[
        [0, 0.9, 0, 0.4],
        [0.2, 1.2, 0.08, 0.28],
        [-0.17, 1.15, -0.06, 0.3],
        [0.05, 1.42, -0.05, 0.22],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <icosahedronGeometry args={[r, 0]} />
          <meshStandardMaterial color={i % 2 ? "#5d9150" : "#467a3d"} roughness={0.9} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function WaterCooler({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh position-y={0.5} castShadow>
        <boxGeometry args={[0.45, 1.0, 0.45]} />
        <meshStandardMaterial color="#e8e8ec" />
      </mesh>
      <mesh position-y={1.25} castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.5, 16]} />
        <meshStandardMaterial color="#7fc4f0" transparent opacity={0.75} />
      </mesh>
    </group>
  );
}

// ─── Mobilya ───────────────────────────────────────────────────────────────────

/** Monitörlü çalışma masası. `screenOn` iken ekran ve önündeki ışık yanar. */
export function ComputerDesk({ position, p, screenOn, accentHex, big = false, isDark }: {
  position: Vec3;
  p: Palette;
  screenOn: boolean;
  accentHex: string;
  big?: boolean;
  isDark: boolean;
}) {
  const w = big ? 2.2 : 1.6;
  const d = 0.8;
  const glow = useRef<THREE.PointLight>(null);
  // Tüm ekranlar aynı malzemeyi paylaşır (Claude'un iki monitörü birlikte yanar)
  const screen = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0d1424", emissive: accentHex, emissiveIntensity: 0.05 }), [accentHex]);

  useFrame((state) => {
    // Çalışırken ekran hafifçe titrer (yazı akıyor)
    const flicker = screenOn ? 0.9 + Math.sin(state.clock.elapsedTime * 13) * 0.1 : 0;
    screen.emissiveIntensity = screenOn ? 1.2 * flicker : 0.05;
    if (glow.current) glow.current.intensity = screenOn ? (isDark ? 2.2 : 0.8) * flicker : 0;
  });

  return (
    <group position={position}>
      <mesh position-y={0.76} castShadow receiveShadow>
        <boxGeometry args={[w, 0.07, d]} />
        <meshStandardMaterial color={p.wood} roughness={0.6} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * (w / 2 - 0.06), 0.37, 0]} castShadow>
          <boxGeometry args={[0.07, 0.74, d - 0.08]} />
          <meshStandardMaterial color={p.woodDark} roughness={0.7} />
        </mesh>
      ))}
      {/* Monitör(ler): ekran çalışana (arkaya, -z) bakar */}
      {(big ? [-0.45, 0.45] : [0]).map((mx) => (
        <group key={mx} position={[mx, 0.8, 0.12]}>
          <mesh position-y={0.08}>
            <boxGeometry args={[0.08, 0.16, 0.08]} />
            <meshStandardMaterial color={p.metal} />
          </mesh>
          <mesh position-y={0.4} castShadow>
            <boxGeometry args={[0.78, 0.5, 0.07]} />
            <meshStandardMaterial color={p.metal} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.4, -0.037]} rotation-y={Math.PI} material={screen}>
            <planeGeometry args={[0.7, 0.42]} />
          </mesh>
        </group>
      ))}
      <pointLight ref={glow} position={[0, 1.25, -0.35]} color={accentHex} intensity={0} distance={2.4} decay={2} />
      {/* Klavye ve kupa */}
      <mesh position={[0, 0.81, -0.18]}>
        <boxGeometry args={[0.55, 0.03, 0.18]} />
        <meshStandardMaterial color="#d9d6cf" />
      </mesh>
      <mesh position={[w / 2 - 0.22, 0.86, -0.1]} castShadow>
        <cylinderGeometry args={[0.06, 0.055, 0.13, 12]} />
        <meshStandardMaterial color="#f1e6cf" />
      </mesh>
      {big && (
        <group position={[-w / 2 + 0.25, 0.8, 0.15]}>
          {/* Masa lambası */}
          <mesh position-y={0.02}>
            <cylinderGeometry args={[0.12, 0.14, 0.04, 14]} />
            <meshStandardMaterial color="#2b2230" />
          </mesh>
          <mesh position-y={0.28}>
            <cylinderGeometry args={[0.015, 0.015, 0.5, 6]} />
            <meshStandardMaterial color="#2b2230" />
          </mesh>
          <mesh position={[0, 0.55, -0.04]} rotation-x={0.5}>
            <coneGeometry args={[0.15, 0.18, 16, 1, true]} />
            <meshStandardMaterial color="#3e7a5c" side={THREE.DoubleSide} />
          </mesh>
          <pointLight position={[0, 0.45, -0.15]} color="#ffcf8a" intensity={isDark ? 4 : 1.2} distance={4} decay={2} />
        </group>
      )}
    </group>
  );
}

export function OfficeChair({ position, color }: { position: Vec3; color: string }) {
  return (
    <group position={position}>
      <mesh position-y={0.12}>
        <cylinderGeometry args={[0.28, 0.28, 0.04, 5]} />
        <meshStandardMaterial color="#2b2b33" />
      </mesh>
      <mesh position-y={0.28}>
        <cylinderGeometry args={[0.035, 0.035, 0.3, 8]} />
        <meshStandardMaterial color="#2b2b33" />
      </mesh>
      <mesh position-y={0.46} castShadow>
        <boxGeometry args={[0.55, 0.1, 0.5]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.85, -0.25]} castShadow>
        <boxGeometry args={[0.52, 0.65, 0.09]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Dinlenme köşesi: halı, kanepe, iki koltuk, sehpa, puf ve lambader */
export function Lounge({ p, isDark }: { p: Palette; isDark: boolean }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[5.3, 0.012, -3.3]} receiveShadow>
        <planeGeometry args={[4.6, 3.6]} />
        <meshStandardMaterial color={p.rug} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[5.3, 0.014, -3.3]}>
        <planeGeometry args={[4.2, 3.2]} />
        <meshStandardMaterial color={new THREE.Color(p.rug).multiplyScalar(1.15).getStyle()} roughness={1} />
      </mesh>
      {/* Kanepe */}
      <group position={[5.3, 0, -5.15]}>
        <mesh position-y={0.25} castShadow receiveShadow>
          <boxGeometry args={[3.3, 0.36, 0.85]} />
          <meshStandardMaterial color={p.fabric} roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.65, -0.33]} castShadow>
          <boxGeometry args={[3.3, 0.6, 0.2]} />
          <meshStandardMaterial color={p.fabric} roughness={0.95} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 1.6, 0.45, 0]} castShadow>
            <boxGeometry args={[0.18, 0.42, 0.85]} />
            <meshStandardMaterial color={p.fabric} roughness={0.95} />
          </mesh>
        ))}
      </group>
      {/* Koltuklar */}
      {[
        [3.45, -2.75, Math.PI / 2.4],
        [7.1, -2.75, -Math.PI / 2.4],
      ].map(([x, z, r], i) => (
        <group key={i} position={[x, 0, z]} rotation-y={r}>
          <mesh position-y={0.25} castShadow>
            <boxGeometry args={[0.85, 0.36, 0.8]} />
            <meshStandardMaterial color="#b56b4c" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.62, -0.33]} castShadow>
            <boxGeometry args={[0.85, 0.6, 0.16]} />
            <meshStandardMaterial color="#b56b4c" roughness={0.95} />
          </mesh>
        </group>
      ))}
      {/* Puf */}
      <mesh position={[5.3, 0.17, -1.45]} castShadow>
        <cylinderGeometry args={[0.36, 0.38, 0.34, 18]} />
        <meshStandardMaterial color="#e3b04b" roughness={0.95} />
      </mesh>
      {/* Sehpa, üstünde kitaplar */}
      <group position={[5.3, 0, -3.35]}>
        <mesh position-y={0.36} castShadow receiveShadow>
          <boxGeometry args={[1.4, 0.06, 0.75]} />
          <meshStandardMaterial color={p.wood} roughness={0.6} />
        </mesh>
        {[-1, 1].map((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`${sx}${sz}`} position={[sx * 0.62, 0.17, sz * 0.3]}>
              <boxGeometry args={[0.05, 0.34, 0.05]} />
              <meshStandardMaterial color={p.woodDark} />
            </mesh>
          )),
        )}
        <mesh position={[-0.3, 0.43, 0]} rotation-y={0.3} castShadow>
          <boxGeometry args={[0.38, 0.07, 0.28]} />
          <meshStandardMaterial color="#2f4f6f" />
        </mesh>
        <mesh position={[0.35, 0.44, 0.05]} castShadow>
          <cylinderGeometry args={[0.07, 0.06, 0.12, 12]} />
          <meshStandardMaterial color="#d97757" />
        </mesh>
      </group>
      {/* Lambader */}
      <group position={[3.2, 0, -5.3]}>
        <mesh position-y={0.85}>
          <cylinderGeometry args={[0.025, 0.025, 1.7, 8]} />
          <meshStandardMaterial color="#2b2230" />
        </mesh>
        <mesh position-y={1.75}>
          <coneGeometry args={[0.28, 0.32, 18, 1, true]} />
          <meshStandardMaterial color="#f3e2c0" emissive="#ffcf8a" emissiveIntensity={isDark ? 0.6 : 0.15} side={THREE.DoubleSide} />
        </mesh>
        <pointLight position-y={1.6} color="#ffcf8a" intensity={isDark ? 6 : 1.5} distance={6} decay={2} />
      </group>
    </group>
  );
}
