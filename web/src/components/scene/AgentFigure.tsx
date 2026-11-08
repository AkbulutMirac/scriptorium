import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { anchors, useHovered } from "./labels";
import type { Seat, Vec3 } from "./layout";
import type { Pose } from "./placement";

export type { Pose };

type Props = {
  /** Agent id ("claude" or worker id); the label layer matches on this */
  id: string;
  name: string;
  color: string;
  pose: Pose;
  seat: Seat;
  selected: boolean;
  accentHex: string;
  isClaude?: boolean;
  /** Where it first appears (defaults to the seat). Copies walk into the room from here. */
  spawn?: Vec3;
  onSelect: () => void;
};

const SKIN = "#f2d3b8";
const EYE = "#2a1d17";

/** A single agent character. When its pose changes it walks/jumps to the new seat. */
export function AgentFigure(p: Props) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const footL = useRef<THREE.Mesh>(null);
  const footR = useRef<THREE.Mesh>(null);
  const target = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const hatColor = useMemo(() => new THREE.Color(p.color).multiplyScalar(0.62).getStyle(), [p.color]);
  const anchor = useRef<THREE.Group>(null);

  // The spawn position is set only once. Passing position as a prop would, on pose change, teleport the character
  // to the new spot and override the walking animation.
  useLayoutEffect(() => {
    root.current?.position.set(...(p.spawn ?? p.seat.pos));
    if (root.current) root.current.rotation.y = p.spawn ? Math.PI : p.seat.rot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register the overhead point with the label layer
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
    const walking = dist > 0.06;

    // Walks at constant speed (farther spots take longer), settles smoothly into place on arrival
    if (walking) {
      dir.subVectors(target, g.position);
      const step = Math.min(dist, 2.4 * dt);
      g.position.addScaledVector(dir.normalize(), step);
    } else {
      g.position.lerp(target, 1 - Math.pow(0.001, dt));
    }

    // Faces its direction of travel while walking, the seat rotation on arrival
    const desired = walking ? Math.atan2(target.x - g.position.x, target.z - g.position.z) : p.seat.rot;
    let dr = desired - g.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    g.rotation.y += dr * (1 - Math.pow(0.0005, dt));

    const t = state.clock.elapsedTime;
    const h = head.current;
    const swing = Math.sin(t * 13);
    if (footL.current && footR.current) {
      // Feet: alternate forward-back and up while walking, tucked together when seated
      footL.current.position.set(-0.12, 0.06 + (walking ? Math.max(0, swing) * 0.08 : 0), walking ? swing * 0.14 : 0.08);
      footR.current.position.set(0.12, 0.06 + (walking ? Math.max(0, -swing) * 0.08 : 0), walking ? -swing * 0.14 : 0.08);
    }
    if (walking) {
      body.current.position.y = Math.abs(swing) * 0.06; // slight bounce on each step
      body.current.rotation.set(0.12, 0, swing * 0.07); // leaning forward, swaying side to side
      h.rotation.set(-0.05, 0, 0);
    } else if (p.pose === "working") {
      body.current.rotation.set(0, 0, 0);
      body.current.position.y = Math.abs(Math.sin(t * 8)) * 0.025; // typing rapidly
      h.rotation.set(0.12 + Math.sin(t * 3) * 0.04, Math.sin(t * 0.8) * 0.15, 0);
    } else if (p.pose === "error") {
      body.current.rotation.set(0, 0, 0);
      body.current.position.y = 0;
      h.rotation.set(0, 0, Math.sin(t * 16) * 0.08); // shaking its head
    } else if (p.pose === "sleeping") {
      body.current.rotation.set(0, 0, 0);
      body.current.position.y = Math.sin(t * 1.2) * 0.012;
      h.rotation.set(0.55, 0, 0.15); // slumped over the desk
    } else {
      body.current.rotation.set(0, 0, 0);
      body.current.position.y = Math.sin(t * 1.4) * 0.012; // calm breathing
      h.rotation.set(0.32, 0, Math.sin(t * 0.6) * 0.05); // looking at the book
    }
  });

  return (
    <group
      ref={root}
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

      {/* Feet */}
      {[footL, footR].map((ref, i) => (
        <mesh key={i} ref={ref} position={[i ? 0.12 : -0.12, 0.06, 0.08]} castShadow>
          <sphereGeometry args={[0.085, 10, 8]} />
          <meshStandardMaterial color={hatColor} roughness={0.8} />
        </mesh>
      ))}
      <group ref={body}>
        {/* Body */}
        <mesh castShadow position-y={0.5}>
          <capsuleGeometry args={[0.27, 0.38, 6, 14]} />
          <meshStandardMaterial
            color={p.color}
            roughness={0.7}
            emissive={p.pose === "error" ? "#ff2a2a" : "#000000"}
            emissiveIntensity={p.pose === "error" ? 0.5 : 0}
          />
        </mesh>
        {/* Head */}
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
            // Head printer's cap
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
            // Worker's beanie and pompom
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

      {/* Overhead point tracked by the label layer */}
      <group ref={anchor} position={[0, 1.5, 0]} />
    </group>
  );
}
