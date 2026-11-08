/** localStorage wrapper. Silently falls back to the default in private windows or when blocked. */
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
    /* no storage is fine: the preference just won't be remembered */
  }
}
