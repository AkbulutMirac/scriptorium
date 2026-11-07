export type Vec3 = [number, number, number];

/** Karakterin oturduğu yer ve baktığı yön (y ekseni dönüşü; 0 = kameraya doğru, +z) */
export type Seat = { pos: Vec3; rot: number };

export type Workstation = { desk: Vec3; seat: Seat };

/** Oda: sol duvar x = -ROOM_HALF_X, arka duvar z = ROOM_BACK_Z. Ön ve sağ taraf açık (izometrik kesit). */
export const ROOM_HALF_X = 7.5;
export const ROOM_BACK_Z = -6;

/** Oturunca karakterin yerden yüksekliği */
export const SEAT_HEIGHT = 0.18;

/** Baş yazıcının masası: arka duvarın önünde, raflarla çevrili */
export const CLAUDE_STATION: Workstation = { desk: [-3, 0, -3.95], seat: { pos: [-3, SEAT_HEIGHT, -4.75], rot: 0 } };

const COLUMNS = [-4.6, -1.4, 1.8];
const FIRST_ROW_Z = -1.0;
const ROW_GAP = 3.0;

/** İşçi masaları: sıra sıra, her sırada üç masa. Herkes kameraya dönük çalışır. */
export function workstations(count: number): Workstation[] {
  return Array.from({ length: count }, (_, i) => {
    const x = COLUMNS[i % COLUMNS.length];
    const z = FIRST_ROW_Z + Math.floor(i / COLUMNS.length) * ROW_GAP;
    return { desk: [x, 0, z + 0.75], seat: { pos: [x, SEAT_HEIGHT, z], rot: 0 } };
  });
}

/** Odanın ön kenarı (işçi sayısı arttıkça oda uzar) */
export function roomFrontZ(count: number) {
  const rows = Math.max(1, Math.ceil(count / COLUMNS.length));
  return Math.max(5.5, FIRST_ROW_Z + (rows - 1) * ROW_GAP + 2.8);
}

/** Dinlenme köşesi (sağ arka): boştaki işçiler burada oturup kitap okur */
export const LOUNGE_SEATS: Seat[] = [
  { pos: [4.25, SEAT_HEIGHT + 0.05, -4.95], rot: 0 },
  { pos: [5.3, SEAT_HEIGHT + 0.05, -4.95], rot: 0 },
  { pos: [6.35, SEAT_HEIGHT + 0.05, -4.95], rot: 0 },
  { pos: [3.55, SEAT_HEIGHT + 0.05, -2.75], rot: Math.PI / 2.4 },
  { pos: [7.0, SEAT_HEIGHT + 0.05, -2.75], rot: -Math.PI / 2.4 },
  { pos: [5.3, SEAT_HEIGHT - 0.06, -1.55], rot: Math.PI },
];

/** Tekrarlanabilir rastgele sayı üreteci (raflardaki kitaplar her açılışta aynı dursun) */
export function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
