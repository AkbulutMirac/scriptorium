/** localStorage sarmalayıcı. Gizli pencerede ya da engellendiğinde sessizce varsayılana döner. */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`scriptorium.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`scriptorium.${key}`, JSON.stringify(value));
  } catch {
    /* depolama yoksa önemli değil: sadece tercih hatırlanmaz */
  }
}
