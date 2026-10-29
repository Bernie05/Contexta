// localStorage can throw (private mode, blocked storage), so it's only used for
// conveniences such as the last chosen model, and failures are ignored.

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
