import type * as THREE from "three";
import { create } from "zustand";

/**
 * Etiketler 3D sahnenin içinde değil, üstündeki normal bir HTML katmanında çizilir.
 * (drei <Html> her etiket için ayrı React kökü açıyor ve React 19'da kaybolabiliyordu.)
 * Her karakter baş üstü noktasını buraya kaydeder; sahnedeki izleyici her karede bu noktayı
 * ekran koordinatına çevirip ilgili etiket kutusunu oraya taşır.
 */
export const anchors = new Map<string, THREE.Object3D>();
export const labelEls = new Map<string, HTMLDivElement>();

/** Fareyle üzerine gelinen karakter */
export const useHovered = create<{ id: string | null }>(() => ({ id: null }));
