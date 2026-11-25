// Pure helpers for the sample mod. No top-level side effects (A2 rule 2).

/** A map keyed by data: null prototype, so "__proto__" / "toString" are plain keys. */
export function makeCounts() {
  return Object.create(null);
}

export function bump(counts, key) {
  counts[key] = (Object.hasOwn(counts, key) ? counts[key] : 0) + 1;
  return counts[key];
}

export function describeCounts(counts) {
  return Object.keys(counts)
    .sort()
    .map((key) => `${key}=${counts[key]}`)
    .join(" ");
}

/** Busy-waits for ms of real time (used to test the render budget). */
export function spin(ms) {
  const end = performance.now() + ms;
  let n = 0;
  while (performance.now() < end) n += 1;
  return n;
}
