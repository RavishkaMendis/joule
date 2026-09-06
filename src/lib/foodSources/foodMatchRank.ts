// ═══════════════════════════════════════════════════════════════════════
// FOOD MATCH RANKING — BUG 2 fix ("Searching 'chicken' didn't let me find
// chicken thighs — just chicken raw mince or whatever").
//
// Root cause (diagnosed, task brief): the data is fine — AFCD has
// "Chicken, thigh, lean flesh, raw" plus 6 more thigh entries and 43
// entries starting with "Chicken". The old `searchAfcd` did a plain
// case-insensitive substring filter and then sorted by NAME LENGTH alone
// ("tighter match" as a proxy for relevance). Length is a bad proxy:
// "Sauce, butter chicken, commercial" and "Pie, savoury, chicken &
// vegetable, commercial" both contain "chicken" as a late, incidental
// word and are SHORTER than "Chicken, thigh, lean flesh, raw", so they
// sorted ahead of it — a real dead-end for a query as basic as "chicken".
//
// This module is the pure, independently-tested replacement: a real
// relevance score, not a length proxy.
//
// Ranking rule (task brief, verbatim):
//   "Exact match > starts-with > word-boundary match > substring
//    anywhere; multi-word queries favour entries containing all terms.
//    AFCD names are comma-separated with the cut in position 2
//    ('Chicken, thigh, lean flesh, raw'), so early-term position should
//    weigh heavily."
//
// How it's implemented:
//   1. The query is split into whitespace-separated TERMS (punctuation
//      stripped first, so "chicken, breast" behaves the same as "chicken
//      breast" — AFCD names and user queries both use commas as
//      separators, and the two should be interchangeable).
//   2. A name that is missing even ONE query term ANYWHERE is not a match
//      at all (returns `null`) — "multi-word queries favour entries
//      containing all terms" is implemented as a hard requirement, not
//      just a tiebreaker, which is what stops "Pie, savoury, chicken &
//      vegetable, commercial" (no "thigh" anywhere) from out-ranking
//      "Chicken, thigh, lean flesh, raw" for the query "chicken thigh" —
//      it doesn't even qualify as a candidate.
//   3. Each present term is scored against every comma-separated SEGMENT
//      of the name, best segment wins: exact segment match > segment
//      starts-with-term > term as a whole word (boundary) anywhere in the
//      segment > term as a bare substring anywhere in the segment. That
//      per-segment score is then weighted down the further into the name
//      the segment sits (`1 / (segmentIndex + 1)`) — AFCD's own
//      convention puts the defining cut (the actual food, e.g. "thigh")
//      in an early segment and qualifiers/prep-method later, so an early
//      hit should dominate a late one.
//   4. Term scores sum; a whole-name-starts-with-the-full-query bonus is
//      added on top so "Chicken, thigh, ..." for the literal query
//      "chicken, thigh" scores even further ahead of any partial/
//      scattered match.
// ═══════════════════════════════════════════════════════════════════════

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strips everything but letters/digits/whitespace, so query punctuation (commas, "&") never prevents a term from lining up with a name segment. */
function toTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Best (highest) tier score for `term` against a single name segment, or `null` if the term doesn't appear in this segment at all. */
function scoreTermInSegment(term: string, segment: string): number | null {
  if (segment === term) return 1000; // exact segment match
  if (segment.startsWith(term)) return 500; // starts-with
  if (new RegExp(`\\b${escapeRegExp(term)}\\b`).test(segment)) return 200; // word-boundary
  if (segment.includes(term)) return 50; // bare substring
  return null;
}

/** Best (position-weighted) score for `term` across every segment of the name, or `null` if it appears in none. */
function scoreTermAgainstSegments(term: string, segments: string[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < segments.length; i++) {
    const tier = scoreTermInSegment(term, segments[i]);
    if (tier === null) continue;
    const weighted = tier / (i + 1); // early segment (the AFCD "cut") weighs most
    if (best === null || weighted > best) best = weighted;
  }
  return best;
}

/**
 * Scores how well `name` matches `query`. Higher is better; `null` means
 * "not a match at all" (should be excluded from results, not merely
 * ranked low) — either the query was blank, or at least one query term
 * is entirely absent from the name.
 *
 * Pure and total: never throws, and depends only on its two string
 * arguments — see foodMatchRank.test.ts for the exact acceptance cases
 * this exists to lock in.
 */
export function scoreFoodNameMatch(name: string, query: string): number | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return null;
  const normalizedName = name.trim().toLowerCase();

  if (normalizedName === normalizedQuery) return Number.POSITIVE_INFINITY; // exact match, always first

  const terms = toTerms(normalizedQuery);
  if (terms.length === 0) return null; // query was pure punctuation — nothing usable to match on

  const segments = normalizedName.split(',').map((s) => s.trim());

  let total = 0;
  for (const term of terms) {
    const termScore = scoreTermAgainstSegments(term, segments);
    if (termScore === null) return null; // a required term is missing entirely — not a match
    total += termScore;
  }

  // Extra bonus when the name starts with the full query's TERMS in order
  // (not just each term individually, and not sensitive to whether the
  // query or the name used a comma vs a space as separator — "chicken
  // breast" and "chicken, breast" must score identically) — rewards a
  // query typed in the same "Food, cut, ..." order AFCD itself uses.
  const cleanedName = segments.join(' ');
  if (cleanedName.startsWith(terms.join(' '))) total += 500;

  return total;
}

/**
 * Ranks `items` by `scoreFoodNameMatch(nameOf(item), query)`, dropping
 * non-matches (`null` scores) entirely rather than ranking them low —
 * "not found" and "found but 500th" must never be conflated. Ties break
 * on shorter name first (a tighter, less-qualified match), preserving
 * the old length-based intuition as a tiebreaker rather than the primary
 * signal it used to wrongly be.
 */
export function rankFoodMatches<T>(items: T[], query: string, nameOf: (item: T) => string): T[] {
  const scored = items
    .map((item) => ({ item, score: scoreFoodNameMatch(nameOf(item), query) }))
    .filter((s): s is { item: T; score: number } => s.score !== null);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return nameOf(a.item).length - nameOf(b.item).length;
  });

  return scored.map((s) => s.item);
}
