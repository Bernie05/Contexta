/** A copy of `set` with `value` flipped, or forced on/off when `on` is given. */
export function toggled<T>(set: Set<T>, value: T, on = !set.has(value)): Set<T> {
  const next = new Set(set);
  if (on) next.add(value);
  else next.delete(value);
  return next;
}
