// ═══════════════════════════════════════════════════════════════════════
// CHART SCALING — pure math shared by the Trends chart components.
//
// Kept out of the components themselves so the coordinate math (the part
// most prone to off-by-one/NaN bugs with empty or single-point series) is
// plain-Node-testable, per the task brief's "test the logic that's
// testable in plain Node" instruction.
// ═══════════════════════════════════════════════════════════════════════

export type Scale = {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
};

/** Build a linear scale mapping [domainMin, domainMax] -> [rangeMin, rangeMax]. Degenerates safely when domain has zero width. */
export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;

  const scale = ((value: number): number => {
    if (span === 0 || !Number.isFinite(span)) return (r0 + r1) / 2;
    const t = (value - d0) / span;
    return r0 + t * (r1 - r0);
  }) as Scale;

  scale.domain = domain;
  scale.range = range;
  return scale;
}

/** Min/max across one or more numeric arrays, ignoring null/NaN/undefined. Returns null if nothing finite is found. */
export function numericExtent(...series: (readonly (number | null | undefined)[])[]): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const arr of series) {
    for (const v of arr) {
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity || max === -Infinity) return null;
  return [min, max];
}

/** Pad a numeric domain by a fraction of its span (or a fixed amount if the span is 0), so lines don't touch the chart edge. */
export function padDomain([min, max]: [number, number], fraction = 0.1, minPad = 1): [number, number] {
  const span = max - min;
  const pad = span > 0 ? span * fraction : minPad;
  return [min - pad, max + pad];
}
