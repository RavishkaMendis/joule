// ═══════════════════════════════════════════════════════════════════════
// SOURCE / CONFIDENCE BREAKDOWN — PRD §10: "A ±15% photo estimate must not
// look identical to a barcode scan." This tells the user how much of
// their logged intake to actually trust.
//
// Operates on food_entry rows (source + confidence + kcal), NOT
// day_intake — the rollup table has no source/confidence columns, only
// the raw entries do. Weighted by kcal so a 900kcal photo-estimated meal
// counts for more than a 40kcal barcode-scanned condiment, which is the
// honest way to answer "how much of what I ate today do I actually
// trust?" rather than "how many taps were exact?".
// ═══════════════════════════════════════════════════════════════════════

export type SourceBreakdownEntry = {
  kcal: number;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  source: string;
};

export type ConfidenceBreakdown = {
  confidence: SourceBreakdownEntry['confidence'];
  kcal: number;
  /** Fraction of total logged kcal in this window at this confidence level. Null if there was no logged kcal at all. */
  fraction: number | null;
};

export type SourceBreakdownSummary = {
  totalKcal: number;
  totalEntries: number;
  byConfidence: ConfidenceBreakdown[];
  /** kcal-weighted fraction that is 'exact' or 'high' confidence — a single "how much do I trust this" number. Null if nothing logged. */
  trustedFraction: number | null;
};

const CONFIDENCE_ORDER: SourceBreakdownEntry['confidence'][] = ['exact', 'high', 'medium', 'low'];

/**
 * Summarise how much logged intake (by kcal) came from each confidence
 * tier across a set of food_entry rows. An empty input returns all-null
 * fractions and zero totals — never a divide-by-zero NaN.
 */
export function summarizeSourceBreakdown(entries: SourceBreakdownEntry[]): SourceBreakdownSummary {
  const totalKcal = entries.reduce((sum, e) => sum + e.kcal, 0);
  const totalEntries = entries.length;

  const kcalByConfidence = new Map<SourceBreakdownEntry['confidence'], number>();
  for (const level of CONFIDENCE_ORDER) kcalByConfidence.set(level, 0);
  for (const e of entries) {
    kcalByConfidence.set(e.confidence, (kcalByConfidence.get(e.confidence) ?? 0) + e.kcal);
  }

  const byConfidence: ConfidenceBreakdown[] = CONFIDENCE_ORDER.map((confidence) => {
    const kcal = kcalByConfidence.get(confidence) ?? 0;
    return { confidence, kcal, fraction: totalKcal > 0 ? kcal / totalKcal : null };
  });

  const trustedKcal = (kcalByConfidence.get('exact') ?? 0) + (kcalByConfidence.get('high') ?? 0);
  const trustedFraction = totalKcal > 0 ? trustedKcal / totalKcal : null;

  return { totalKcal, totalEntries, byConfidence, trustedFraction };
}
