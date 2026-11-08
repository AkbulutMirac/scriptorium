import type * as THREE from "three";
import { create } from "zustand";

/**
 * Labels are drawn not inside the 3D scene, but on a regular HTML layer above it.
 * (drei <Html> opened a separate React root for each label and could disappear in React 19.)
 * Each character registers its overhead point here; the scene observer converts this point every frame
 * into screen coordinates and moves the corresponding label box there.
 */
export const anchors = new Map<string, THREE.Object3D>();
export const labelEls = new Map<string, HTMLDivElement>();

/** Character hovered with the mouse */
export const useHovered = create<{ id: string | null }>(() => ({ id: null }));
