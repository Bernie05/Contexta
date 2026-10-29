import "server-only";

export function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** Trims a user-supplied name and rejects empty or oversized ones. */
export function cleanName(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= max ? name : null;
}
