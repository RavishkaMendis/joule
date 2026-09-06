// ═══════════════════════════════════════════════════════════════════════
// IngredientSearchModal — "build a pot from saved-food/AFCD/OFF search"
// (task brief, meal-prep workflow: "A Sri Lankan curry is mostly generic
// ingredients plus packaged goods, so all three routes matter" — this is
// the third route, alongside the ingredients photo and barcode scan).
//
// Reuses the FULL three-tier food lookup cascade
// (src/lib/foodSources/searchCascade.ts: saved_food -> bundled AFCD ->
// Open Food Facts text search) exactly as FoodEntryScreen's own search
// does — no new lookup logic, same debounce/cancellation/typed-miss
// handling for tier 3. Grouped by source (PRD §10 "Confidence always
// visible") so the user can see where each candidate number came from
// before picking one, mirroring FoodEntryScreen's ResultGroup treatment.
//
// Selecting a result does not immediately add an ingredient row: the
// user still has to say how many RAW grams of it went into the pot (PRD
// §7.5's raw-vs-cooked rule applies here too — a saved-food/AFCD/OFF hit
// is a per-100g basis, not a serving), so this modal has a second small
// step for that before handing back a finished (name, grams, macros,
// confidence) tuple. All the calling screen (PotCreateScreen) does with
// the result is turn it into one more editable ingredient row, exactly
// like a manually typed one.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../../lib/theme';
import { getDatabase } from '../../lib/db';
import { searchLocal, searchRemote } from '../../lib/foodSources/searchCascade';
import type { SavedFoodRow } from '../../db/types';
import type { AfcdFoodRow } from '../../lib/foodSources/afcd';
import { scaleFromPer100g, type EntryConfidence, type PendingEntry } from '../../lib/pendingEntry';
import { parseRequiredNumber } from '../../lib/numericInput';

type Per100g = NonNullable<PendingEntry['per100g']>;

/** How long to wait after the last keystroke before hitting Open Food Facts's network — same budget FoodEntryScreen uses (PRD §9.1's 10-second test must never feel like it's blocking typing). */
const OFF_SEARCH_DEBOUNCE_MS = 350;

/** Remote search status, surfaced in the UI so a slow/failed network call is visible rather than a silent gap where results should be. */
type RemoteStatus = 'idle' | 'loading' | 'ok' | 'error';

/** What this modal hands back — the calling screen turns it into a `PotIngredient`/`IngredientDraft` row. */
export type IngredientSearchResult = {
  name: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: EntryConfidence;
  /**
   * The per-100g basis these macros were scaled from (BUG FIX, task brief
   * #1: this used to be discarded here, so a search-hit ingredient row
   * had no basis left to rescale a later grams edit from). Always present
   * — every result in this modal (saved/AFCD/OFF) has a resolved
   * per-100g figure by construction.
   */
  per100g: Per100g;
};

type ResultRow = { key: string; name: string; per100g: Per100g; confidence: EntryConfidence; sourceLabel: 'Saved' | 'Database (AFCD)' | 'Open Food Facts' };

function fromSavedFood(row: SavedFoodRow): ResultRow {
  return {
    key: `saved_${row.id}`,
    name: row.name,
    per100g: {
      kcal: row.kcal_per_100g,
      protein_g: row.protein_per_100g,
      carbs_g: row.carbs_per_100g,
      fat_g: row.fat_per_100g,
    },
    // A saved food's own numbers are whatever the user previously
    // confirmed — treated as ground truth, same as any other manual
    // entry in this app (foodEntryActions.ts's LEGACY_SAVED_FOOD_CONFIDENCE/logManualEntry default to 'exact'/'high').
    confidence: 'exact',
    sourceLabel: 'Saved',
  };
}

function fromAfcd(row: AfcdFoodRow): ResultRow {
  return {
    key: `afcd_${row.id}`,
    name: row.name,
    per100g: {
      kcal: row.kcal_per_100g,
      protein_g: row.protein_per_100g,
      carbs_g: row.carbs_per_100g,
      fat_g: row.fat_per_100g,
    },
    confidence: 'exact', // afcdRowToPendingEntry's own convention (src/lib/foodSources/afcd.ts)
    sourceLabel: 'Database (AFCD)',
  };
}

/** Tier 3: an Open Food Facts search hit already carries its own honestly-assessed confidence (openFoodFacts.ts's `confidenceFor` — 'exact' only when the panel is complete, 'medium'/'low' otherwise) and per-100g basis (already through the kJ/kcal rail). */
function fromOff(entry: PendingEntry): ResultRow {
  return {
    key: entry.barcode ?? `off_${entry.name}`,
    name: entry.name,
    per100g: entry.per100g ?? { kcal: entry.kcal, protein_g: entry.protein_g, carbs_g: entry.carbs_g, fat_g: entry.fat_g },
    confidence: entry.confidence,
    sourceLabel: 'Open Food Facts',
  };
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onPick: (result: IngredientSearchResult) => void;
  /**
   * BUG FIX (task brief #2: "Searching 'chicken' didn't let me find
   * chicken thighs... and I couldn't manually add"): PRD §7.2's "never
   * dead-end the user" applies to this modal too. Called with whatever
   * text the user had typed when they give up on search results —
   * PotCreateScreen turns it into a new manually-editable ingredient row
   * (its pre-existing "+ Add ingredient manually" row, prefilled with
   * this name) so the search text isn't thrown away and retyped, exactly
   * how FoodEntryScreen's own search->manual-entry carries the typed text
   * into the Name field rather than discarding it.
   */
  onManualEntry: (name: string) => void;
};

export function IngredientSearchModal({ visible, onClose, onPick, onManualEntry }: Props) {
  const [query, setQuery] = useState('');
  const [savedResults, setSavedResults] = useState<ResultRow[]>([]);
  const [afcdResults, setAfcdResults] = useState<ResultRow[]>([]);
  const [offResults, setOffResults] = useState<ResultRow[]>([]);
  const [offStatus, setOffStatus] = useState<RemoteStatus>('idle');
  const [selected, setSelected] = useState<ResultRow | null>(null);
  const [gramsText, setGramsText] = useState('');

  // Tier 1 + 2: saved_food + AFCD, local and effectively instant — run on
  // every keystroke with no debounce, same as FoodEntryScreen.
  const runLocalSearch = useCallback(async (q: string) => {
    if (q.trim().length === 0) {
      setSavedResults([]);
      setAfcdResults([]);
      return;
    }
    const db = await getDatabase();
    const local = await searchLocal(db, q);
    setSavedResults(local.savedFood.map(fromSavedFood));
    setAfcdResults(local.afcd.map(fromAfcd));
  }, []);

  // Tier 3: Open Food Facts, debounced and cancellable — the requestId
  // guard discards any response that arrives after a newer query has
  // superseded it, and a network failure resolves to a typed miss (empty
  // results + `offStatus: 'error'`) rather than throwing (searchRemote /
  // searchOpenFoodFacts never throw).
  const offRequestId = useRef(0);
  useEffect(() => {
    const text = query.trim();
    if (!visible || text.length === 0) {
      setOffResults([]);
      setOffStatus('idle');
      return;
    }

    const thisRequestId = ++offRequestId.current;
    setOffStatus('loading');
    const timer = setTimeout(() => {
      void searchRemote(text).then((result) => {
        if (offRequestId.current !== thisRequestId) return; // superseded — discard
        if (result.ok) {
          setOffResults(result.results.map(fromOff));
          setOffStatus('ok');
        } else {
          setOffResults([]);
          setOffStatus('error');
        }
      });
    }, OFF_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, visible]);

  const runSearch = useCallback(
    (q: string) => {
      setQuery(q);
      void runLocalSearch(q);
    },
    [runLocalSearch]
  );

  const reset = useCallback(() => {
    setQuery('');
    setSavedResults([]);
    setAfcdResults([]);
    setOffResults([]);
    setOffStatus('idle');
    setSelected(null);
    setGramsText('');
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleManualEntry = () => {
    const typed = query.trim();
    reset();
    onManualEntry(typed);
  };

  const parsedGrams = parseRequiredNumber(gramsText);
  const canAdd = selected !== null && parsedGrams.valid && parsedGrams.value > 0;

  const handleAdd = () => {
    if (!selected || !parsedGrams.valid) return;
    const grams = parsedGrams.value;
    const macros = scaleFromPer100g(selected.per100g, grams);
    onPick({ name: selected.name, grams, ...macros, confidence: selected.confidence, per100g: selected.per100g });
    reset();
  };

  // Real empty state (PRD §7.2 "never dead-end the user"): only once every
  // tier has definitively finished, never while OFF is still loading —
  // same rule FoodEntryScreen's own search uses.
  const hasAnyResults = savedResults.length > 0 || afcdResults.length > 0 || offResults.length > 0;
  const showEmptyState = query.trim().length > 0 && !hasAnyResults && offStatus !== 'loading';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose} transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {selected ? (
            <>
              <Text style={styles.title}>{selected.name}</Text>
              <Text style={styles.hint}>How many grams of this (raw, as used) went into the pot?</Text>
              <View style={styles.gramsRow}>
                <TextInput
                  style={styles.gramsInput}
                  value={gramsText}
                  onChangeText={setGramsText}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textTertiary}
                  autoFocus
                />
                <Text style={styles.unit}>g</Text>
              </View>
              {parsedGrams.valid && parsedGrams.value > 0 && (
                <Text style={styles.estimate}>
                  ≈ {Math.round(scaleFromPer100g(selected.per100g, parsedGrams.value).kcal)} kcal
                </Text>
              )}
              <View style={styles.actions}>
                <Pressable onPress={() => setSelected(null)} style={styles.secondaryButton} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Back to search</Text>
                </Pressable>
                <Pressable
                  onPress={handleAdd}
                  disabled={!canAdd}
                  style={[styles.primaryButton, !canAdd && styles.primaryButtonDisabled]}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryText}>Add ingredient</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Search your foods &amp; the database</Text>
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={runSearch}
                placeholder="e.g. rice, lentils, chicken breast…"
                placeholderTextColor={colors.textTertiary}
                autoFocus
              />
              <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
                {savedResults.length > 0 && <ResultGroup label="Saved" rows={savedResults} onPick={setSelected} />}
                {afcdResults.length > 0 && <ResultGroup label="Database (AFCD)" rows={afcdResults} onPick={setSelected} />}
                {(offResults.length > 0 || offStatus === 'loading' || offStatus === 'error') && (
                  <ResultGroup
                    label="Open Food Facts"
                    rows={offResults}
                    onPick={setSelected}
                    loading={offStatus === 'loading'}
                    errorText={offStatus === 'error' ? "Couldn't reach Open Food Facts — try again or search saved/database foods." : undefined}
                  />
                )}
                {showEmptyState && <Text style={styles.emptyText}>No matches — try a shorter or more generic term.</Text>}
              </ScrollView>
              {/* PRD §7.2 "never dead-end the user" — always available once
                  something's typed, not just on a total miss: the right
                  match might legitimately not be in saved/AFCD/OFF at all
                  (a homemade spice mix, a local butcher's cut), and the
                  user shouldn't have to cancel out and retype the name. */}
              {query.trim().length > 0 && (
                <Pressable
                  onPress={handleManualEntry}
                  style={({ pressed }) => [styles.manualEntryLink, pressed && styles.manualEntryLinkPressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.manualEntryLinkText}>Can&apos;t find it? Add &ldquo;{query.trim()}&rdquo; manually</Text>
                </Pressable>
              )}
              <Pressable onPress={handleClose} style={styles.secondaryButton} accessibilityRole="button">
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * One labelled group of search results (PRD §10 "Confidence always
 * visible" applied to search: grouping by source is what lets the user
 * see whether a candidate came from their own saved foods, the bundled
 * generic database, or a crowd-sourced OFF product) — same treatment as
 * FoodEntryScreen's own ResultGroup.
 */
function ResultGroup({
  label,
  rows,
  onPick,
  loading,
  errorText,
}: {
  label: string;
  rows: ResultRow[];
  onPick: (row: ResultRow) => void;
  loading?: boolean;
  errorText?: string;
}) {
  return (
    <View style={styles.resultsGroup}>
      <View style={styles.resultsGroupHeader}>
        <Text style={styles.resultsGroupLabel}>{label}</Text>
        {loading && <ActivityIndicator size="small" color={colors.textTertiary} />}
      </View>
      {errorText && <Text style={styles.resultsError}>{errorText}</Text>}
      {rows.slice(0, 6).map((row) => (
        <Pressable
          key={row.key}
          onPress={() => onPick(row)}
          style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
          accessibilityRole="button"
        >
          <View style={styles.resultTextGroup}>
            <Text style={styles.resultName}>{row.name}</Text>
            <Text style={styles.resultMeta}>{Math.round(row.per100g.kcal)} kcal/100g</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  resultsGroup: {
    marginBottom: spacing.sm,
  },
  resultsGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  resultsGroupLabel: {
    ...type.sectionLabel,
    color: colors.textTertiary,
  },
  resultsError: {
    ...type.small,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    maxHeight: '80%',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: {
    ...type.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  hint: {
    ...type.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  searchInput: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  list: {
    marginBottom: spacing.sm,
  },
  resultRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  resultRowPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  resultTextGroup: {},
  resultName: {
    ...type.body,
    color: colors.text,
  },
  resultMeta: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
    marginTop: 2,
  },
  emptyText: {
    ...type.body,
    color: colors.textTertiary,
    paddingVertical: spacing.md,
  },
  manualEntryLink: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  manualEntryLinkPressed: {
    opacity: 0.7,
  },
  manualEntryLinkText: {
    ...type.body,
    color: colors.accent,
  },
  gramsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  gramsInput: {
    ...type.display,
    ...numeric,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minWidth: 120,
    paddingVertical: spacing.xs,
  },
  unit: {
    ...type.h2,
    color: colors.textSecondary,
  },
  estimate: {
    ...type.body,
    ...numeric,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  secondaryButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  secondaryText: {
    ...type.body,
    color: colors.textSecondary,
  },
  primaryButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryText: {
    ...type.bodyStrong,
    color: colors.background,
  },
});
