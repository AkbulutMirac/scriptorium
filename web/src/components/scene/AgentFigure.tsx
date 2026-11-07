import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { anchors, useHovered } from "./labels";
import type { Seat } from "./layout";
import type { Pose } from "./placement";

export type { Pose };

type Props = {
  /** Ajan id'si ("claude" ya da işçi id'si); etiket katmanı bununla eşleşir */
  id: string;
  name: string;
  color: string;
  pose: Pose;
  seat: Seat;
  selected: boolean;
  accentHex: string;
  isClaude?: boolean;
  onSelect: () => void;
};

const SKIN = "#f2d3b8";
const EYE = "#2a1d17";

/** Tek bir ajan karakteri. Pozu değişince yeni oturma yerine zıplayarak yürür. */
export function AgentFigure(p: Props) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const target = useMemo(() => new THREE.Vector3(), []);
  const hatColor = useMemo(() => new THREE.Color(p.color).multiplyScalar(0.62).getStyle(), [p.color]);
  const anchor = useRef<THREE.Group>(null);

  // Baş üstü noktasını etiket katmanına kaydet
  useEffect(() => {
    const obj = anchor.current;
    if (!obj) return;
    anchors.set(p.id, obj);
    return () => {
      if (anchors.get(p.id) === obj) anchors.delete(p.id);
    };
  }, [p.id]);

  useFrame((state, dt) => {
    const g = root.current;
    if (!g || !body.current || !head.current) return;
    target.set(...p.seat.pos);
    const dist = g.position.distanceTo(target);
    const k = 1 - Math.pow(0.03, dt); // kare hızından bağımsız yumuşak geçiş
    g.position.lerp(target, k * 0.8);
    let dr = p.seat.rot - g.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    g.rotation.y += dr * k;

    const t = state.clock.elapsedTime;
    const h = head.current;
    if (dist > 0.06) {
      body.current.position.y = Math.abs(Math.sin(t * 12)) * 0.14; // zıplayarak yürür
      h.rotation.set(0, 0, 0);
    } else if (p.pose === "working") {
      body.current.position.y = Math.abs(Math.sin(t * 8)) * 0.025; // hızlı hızlı yazıyor
      h.rotation.set(0.12 + Math.sin(t * 3) * 0.04, Math.sin(t * 0.8) * 0.15, 0);
    } else if (p.pose === "error") {
      body.current.position.y = 0;
      h.rotation.set(0, 0, Math.sin(t * 16) * 0.08); // kafa sallıyor
    } else if (p.pose === "sleeping") {
      body.current.position.y = Math.sin(t * 1.2) * 0.012;
      h.rotation.set(0.55, 0, 0.15); // masaya kapanmış
    } else {
      body.current.position.y = Math.sin(t * 1.4) * 0.012; // sakin nefes
      h.rotation.set(0.32, 0, Math.sin(t * 0.6) * 0.05); // kitaba bakıyor
    }
  });

  return (
    <group
      ref={root}
      position={p.seat.pos}
      rotation-y={p.seat.rot}
      onClick={(e) => {
        e.stopPropagation();
        p.onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        useHovered.setState({ id: p.id });
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        if (useHovered.getState().id === p.id) useHovered.setState({ id: null });
        document.body.style.cursor = "";
      }}
    >
      {p.selected && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[0.42, 0.52, 40]} />
          <meshBasicMaterial color={p.accentHex} transparent opacity={0.95} depthTest={false} />
        </mesh>
      )}

      <group ref={body}>
        {/* Gövde */}
        <mesh castShadow position-y={0.5}>
          <capsuleGeometry args={[0.27, 0.38, 6, 14]} />
          <meshStandardMaterial
            color={p.color}
            roughness={0.7}
            emissive={p.pose === "error" ? "#ff2a2a" : "#000000"}
            emissiveIntensity={p.pose === "error" ? 0.5 : 0}
          />
        </mesh>
        {/* Kafa */}
        <group ref={head} position-y={1.02}>
          <mesh castShadow>
            <sphereGeometry args={[0.27, 20, 20]} />
            <meshStandardMaterial color={SKIN} roughness={0.8} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.095, 0.02, 0.235]}>
              <sphereGeometry args={[0.035, 10, 10]} />
              <meshStandardMaterial color={EYE} roughness={0.3} />
            </mesh>
          ))}
          {[-1, 1].map((s) => (
            <mesh key={`c${s}`} position={[s * 0.16, -0.07, 0.2]}>
              <sphereGeometry args={[0.045, 8, 8]} />
              <meshStandardMaterial color="#f0a3a0" roughness={0.9} transparent opacity={0.75} />
            </mesh>
          ))}
          {p.isClaude ? (
            // Baş yazıcının kepi
            <group position-y={0.24}>
              <mesh castShadow>
                <cylinderGeometry args={[0.2, 0.24, 0.12, 18]} />
                <meshStandardMaterial color="#2b2230" roughness={0.6} />
              </mesh>
              <mesh position-y={0.08} rotation-y={Math.PI / 4} castShadow>
                <boxGeometry args={[0.52, 0.035, 0.52]} />
                <meshStandardMaterial color="#2b2230" roughness={0.6} />
              </mesh>
              <mesh position={[0.24, 0.0, 0.1]}>
                <sphereGeometry args={[0.04, 8, 8]} />
                <meshStandardMaterial color="#e8a23a" />
              </mesh>
            </group>
          ) : (
            // İşçinin beresi ve ponponu
            <group position-y={0.08}>
              <mesh castShadow>
                <sphereGeometry args={[0.285, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.3]} />
                <meshStandardMaterial color={hatColor} roughness={0.9} />
              </mesh>
              <mesh position-y={0.27}>
                <sphereGeometry args={[0.07, 10, 10]} />
                <meshStandardMaterial color="#f7f3ea" roughness={0.9} />
              </mesh>
            </group>
          )}
        </group>
        {p.pose === "reading" && (
          <mesh position={[0, 0.66, 0.32]} rotation-x={-0.7} castShadow>
            <boxGeometry args={[0.34, 0.24, 0.05]} />
            <meshStandardMaterial color="#7a2e3b" roughness={0.7} />
          </mesh>
        )}
      </group>

      {/* Etiket katmanının takip ettiği baş üstü noktası */}
      <group ref={anchor} position={[0, 1.5, 0]} />
    </group>
  );
}
