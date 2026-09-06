// ═══════════════════════════════════════════════════════════════════════
// FoodEntryScreen — PRD §9 manual food entry, plus the search-cascade UX
// this task adds. Three ways in:
//
//   1. Search — types into one box, results appear grouped by source
//      (PRD §10 "Confidence always visible": My foods / Generic / Open
//      Food Facts, so the user can see where a number came from):
//        Tier 1: local saved_food  — instant, offline, personal.
//        Tier 2: bundled AFCD      — instant, offline, ~1,588 generic
//                                     foods (rice, chicken breast, dal...).
//        Tier 3: Open Food Facts   — networked, debounced, cancellable,
//                                     never blocks typing or throws.
//      Tapping any result populates the form below exactly like tapping a
//      saved food always has.
//   2. A miss ("no matches") never dead-ends the user (PRD §7.2's
//      principle applied to search) — the typed query is already sitting
//      in the Name field below, ready for manual entry, and an explicit
//      empty-state message says so.
//   3. Free-text a name with grams + macros directly, optionally "save to
//      my foods" so the personal library grows (PRD §7.3 lists this
//      pattern for label OCR; applies just as well to plain manual entry).
//
// Editing an existing entry (route.params.entryId set) pre-fills the form
// from that entry and calls editFoodEntry instead of logManualEntry/
// logQuickAdd — same screen, same date-threading, PRD §10 "everything
// editable forever" including moving an entry to a different date.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import { todayLocalISO, relativeDayLabel } from '../lib/localDate';
import * as foodRepo from '../db/repositories/foodRepo';
import type { SavedFoodRow } from '../db/types';
import { logManualEntry, logQuickAdd, editFoodEntry, deleteFoodEntry } from '../lib/foodEntryActions';
import { searchLocal, searchRemote, afcdToEntry } from '../lib/foodSources/searchCascade';
import type { AfcdFoodRow } from '../lib/foodSources/afcd';
import type { PendingEntry } from '../lib/pendingEntry';
import { parseRequiredNumber } from '../lib/numericInput';

type Nav = NativeStackNavigationProp<RootStackParamList, 'FoodEntry'>;
type Route = RouteProp<RootStackParamList, 'FoodEntry'>;

type NumField = 'grams' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g';

/** How long to wait after the last keystroke before hitting Open Food Facts's network (PRD §9.1's 10-second test — this must never feel like it's blocking typing). */
const OFF_SEARCH_DEBOUNCE_MS = 350;

/** Remote search status, surfaced in the UI so a slow/failed network call is visible rather than a silent gap where results should be. */
type RemoteStatus = 'idle' | 'loading' | 'ok' | 'error';

export function FoodEntryScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const date = route.params?.date ?? todayLocalISO();
  const entryId = route.params?.entryId;
  const isEditing = entryId !== undefined;

  const [query, setQuery] = useState('');
  const [savedResults, setSavedResults] = useState<SavedFoodRow[]>([]);
  const [afcdResults, setAfcdResults] = useState<AfcdFoodRow[]>([]);
  const [offResults, setOffResults] = useState<PendingEntry[]>([]);
  const [offStatus, setOffStatus] = useState<RemoteStatus>('idle');
  const [selectedFood, setSelectedFood] = useState<SavedFoodRow | null>(null);
  /** Source of the currently-populated form, for the entry's provenance (PRD §10). Reset to 'manual' by any hand-edit. */
  const [entrySource, setEntrySource] = useState<'manual' | 'afcd' | 'barcode'>('manual');

  const [name, setName] = useState('');
  const [fields, setFields] = useState<Record<NumField, string>>({
    grams: '',
    kcal: '',
    protein_g: '',
    carbs_g: '',
    fat_g: '',
  });
  const [saveToMyFoods, setSaveToMyFoods] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!isEditing);

  // Pre-fill from the existing entry when editing.
  useEffect(() => {
    if (!isEditing || !entryId) return;
    let cancelled = false;
    (async () => {
      const db = await getDatabase();
      const existing = await foodRepo.getEntry(db, entryId);
      if (!cancelled && existing) {
        setName(existing.name);
        setFields({
          grams: String(existing.grams),
          kcal: String(Math.round(existing.kcal)),
          protein_g: String(Math.round(existing.protein_g)),
          carbs_g: String(Math.round(existing.carbs_g)),
          fat_g: String(Math.round(existing.fat_g)),
        });
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditing, entryId]);

  // ── Tier 1 + 2: saved_food + AFCD. Both are local and effectively
  // instant, so they run on every keystroke with no debounce — comfortably
  // under the 10-second test (PRD §9.1).
  const runLocalSearch = useCallback(async (text: string) => {
    if (isEditing) return;
    if (text.trim().length === 0) {
      setSavedResults([]);
      setAfcdResults([]);
      return;
    }
    const db = await getDatabase();
    const { savedFood, afcd } = await searchLocal(db, text.trim());
    setSavedResults(savedFood);
    setAfcdResults(afcd);
  }, [isEditing]);

  useEffect(() => {
    void runLocalSearch(query);
  }, [query, runLocalSearch]);

  // ── Tier 3: Open Food Facts, debounced and cancellable. A network call
  // fires per keystroke would neither respect OFF's rate limits nor stay
  // under the 10-second test if the connection is slow — debounce absorbs
  // fast typing, and the requestId guard discards any response that
  // arrives after a newer query has superseded it (never lets a stale
  // slow response clobber fresher results, and never throws into the UI
  // on a network failure — see searchRemote/searchOpenFoodFacts).
  const offRequestId = useRef(0);
  useEffect(() => {
    if (isEditing) return;
    const text = query.trim();
    if (text.length === 0) {
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
          setOffResults(result.results);
          setOffStatus('ok');
        } else {
          setOffResults([]);
          setOffStatus('error');
        }
      });
    }, OFF_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, isEditing]);

  const setField = (field: NumField, value: string) => {
    setSelectedFood(null);
    setEntrySource('manual');
    setFields((prev) => ({ ...prev, [field]: value }));
  };

  const applySavedFood = (food: SavedFoodRow) => {
    setSelectedFood(food);
    setEntrySource('manual'); // saved_food entries always log via logQuickAdd/manual, never re-tagged afcd/barcode
    setName(food.name);
    const grams = food.default_grams;
    const scale = grams / 100;
    setFields({
      grams: String(grams),
      kcal: String(Math.round(food.kcal_per_100g * scale)),
      protein_g: String(Math.round(food.protein_per_100g * scale)),
      carbs_g: String(Math.round(food.carbs_per_100g * scale)),
      fat_g: String(Math.round(food.fat_per_100g * scale)),
    });
    clearSearch();
  };

  /** Shared by AFCD and Open Food Facts taps — both hand over a PendingEntry on a 100g basis. */
  const applyPendingEntry = (entry: PendingEntry, source: 'afcd' | 'barcode') => {
    setSelectedFood(null);
    setEntrySource(source);
    setName(entry.name);
    setFields({
      grams: String(entry.grams),
      kcal: String(Math.round(entry.kcal)),
      protein_g: String(Math.round(entry.protein_g)),
      carbs_g: String(Math.round(entry.carbs_g)),
      fat_g: String(Math.round(entry.fat_g)),
    });
    clearSearch();
  };

  const clearSearch = () => {
    setQuery('');
    setSavedResults([]);
    setAfcdResults([]);
    setOffResults([]);
    setOffStatus('idle');
  };

  // A blank string coerces to 0 via Number(''), which also passes
  // Number.isFinite — parseRequiredNumber's blank check stops a cleared
  // field from silently logging as a real, distinct-from-empty zero.
  // grams/kcal have no legitimate 0 (a 0-kcal, 0-gram entry is not a real
  // food log), but protein/carbs/fat legitimately CAN be 0 (e.g. black
  // coffee has 0g fat) — the fix is requiring the field be non-blank and
  // parseable, not requiring it be positive.
  const num = (field: NumField): { valid: boolean; value: number | null } => parseRequiredNumber(fields[field]);
  const canSave =
    name.trim().length > 0 &&
    num('grams').valid &&
    (num('grams').value as number) > 0 &&
    num('kcal').valid &&
    num('protein_g').valid &&
    num('carbs_g').valid &&
    num('fat_g').valid;

  // Real empty state (PRD §7.2 "never dead-end the user"): only once every
  // tier has definitively finished, never while OFF is still loading.
  const hasAnyResults = savedResults.length > 0 || afcdResults.length > 0 || offResults.length > 0;
  const showEmptyState =
    !isEditing && query.trim().length > 0 && !hasAnyResults && offStatus !== 'loading';

  const handleSave = async () => {
    if (!canSave) return;
    // canSave already guarantees every field below parsed successfully.
    const grams = num('grams').value as number;
    const kcal = num('kcal').value as number;
    const protein_g = num('protein_g').value as number;
    const carbs_g = num('carbs_g').value as number;
    const fat_g = num('fat_g').value as number;

    setSaving(true);
    try {
      const db = await getDatabase();

      if (isEditing && entryId) {
        await editFoodEntry(db, entryId, {
          date,
          name: name.trim(),
          grams,
          kcal,
          protein_g,
          carbs_g,
          fat_g,
        });
      } else if (selectedFood && !gramsChangedFromDefault(selectedFood, grams)) {
        // Fast path: unmodified quick-add-equivalent tap on a search result.
        await logQuickAdd(db, selectedFood, date);
      } else {
        await logManualEntry(db, {
          date,
          name: name.trim(),
          grams,
          kcal,
          protein_g,
          carbs_g,
          fat_g,
          confidence: 'exact',
          source: entrySource,
          saveToMyFoods,
        });
      }
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!entryId) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      await deleteFoodEntry(db, entryId);
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <View style={styles.screen} />;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.title}>
          {isEditing ? 'Edit entry' : 'Add food'} — {relativeDayLabel(date)}
        </Text>

        {!isEditing && (
          <>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={(text) => {
                setQuery(text);
                // Carry the typed text straight into Name as it's typed
                // (PRD §7.2: never dead-end the user) — if search comes
                // up empty, the field the user needs next is already
                // filled in rather than making them retype it.
                setSelectedFood(null);
                setEntrySource('manual');
                setName(text);
              }}
              placeholder="Search foods… e.g. sushi, rice, chicken breast"
              placeholderTextColor={colors.textTertiary}
            />

            {savedResults.length > 0 && (
              <ResultGroup
                label="My foods"
                rows={savedResults.map((food) => ({
                  key: food.id,
                  name: food.name,
                  meta: `${Math.round(food.kcal_per_100g)} kcal/100g`,
                  onPress: () => applySavedFood(food),
                }))}
              />
            )}

            {afcdResults.length > 0 && (
              <ResultGroup
                label="Generic (AFCD)"
                rows={afcdResults.map((food) => ({
                  key: food.id,
                  name: food.name,
                  meta: `${Math.round(food.kcal_per_100g)} kcal/100g`,
                  onPress: () => applyPendingEntry(afcdToEntry(food), 'afcd'),
                }))}
              />
            )}

            {(offResults.length > 0 || offStatus === 'loading' || offStatus === 'error') && (
              <ResultGroup
                label="Open Food Facts"
                loading={offStatus === 'loading'}
                errorText={offStatus === 'error' ? "Couldn't reach Open Food Facts — try again or enter manually." : undefined}
                rows={offResults.map((entry, i) => ({
                  key: entry.barcode ?? `${entry.name}-${i}`,
                  name: entry.name,
                  meta: `${Math.round(entry.kcal)} kcal/100g`,
                  onPress: () => applyPendingEntry(entry, 'barcode'),
                }))}
              />
            )}

            {showEmptyState && (
              <Text style={styles.emptyState}>
                No matches for &ldquo;{query.trim()}&rdquo; — enter it manually below.
              </Text>
            )}
          </>
        )}

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.textInput}
          value={name}
          onChangeText={(v) => {
            setSelectedFood(null);
            setEntrySource('manual');
            setName(v);
          }}
          placeholder="e.g. Chicken breast"
          placeholderTextColor={colors.textTertiary}
        />

        <View style={styles.row}>
          <NumericField label="Grams" value={fields.grams} onChange={(v) => setField('grams', v)} />
          <NumericField label="kcal" value={fields.kcal} onChange={(v) => setField('kcal', v)} />
        </View>
        <View style={styles.row}>
          <NumericField label="Protein g" value={fields.protein_g} onChange={(v) => setField('protein_g', v)} />
          <NumericField label="Carbs g" value={fields.carbs_g} onChange={(v) => setField('carbs_g', v)} />
          <NumericField label="Fat g" value={fields.fat_g} onChange={(v) => setField('fat_g', v)} />
        </View>

        {!isEditing && (
          <View style={styles.saveToggleRow}>
            <Text style={styles.label}>Save to my foods</Text>
            <Switch
              value={saveToMyFoods}
              onValueChange={setSaveToMyFoods}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          </View>
        )}

        <View style={styles.actions}>
          {isEditing && (
            <Pressable
              onPress={() => void handleDelete()}
              disabled={saving}
              style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          )}
          <View style={styles.actionsRight}>
            <Pressable
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleSave()}
              disabled={!canSave || saving}
              style={({ pressed }) => [
                styles.saveButton,
                pressed && !(!canSave || saving) && styles.saveButtonPressed,
                (!canSave || saving) && styles.saveButtonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave || saving, busy: saving }}
            >
              {saving ? (
                <View style={styles.saveLoadingRow}>
                  <ActivityIndicator size="small" color={colors.background} />
                  <Text style={styles.saveText}>Saving…</Text>
                </View>
              ) : (
                <Text style={styles.saveText}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function gramsChangedFromDefault(food: SavedFoodRow, grams: number): boolean {
  return Math.abs(grams - food.default_grams) > 0.5;
}

/**
 * One labelled group of search results (PRD §10 "Confidence always
 * visible" applied to search: grouping by source, not just a flat list,
 * is what lets the user see whether a number came from their own saved
 * foods, the bundled generic database, or a crowd-sourced OFF product).
 */
function ResultGroup({
  label,
  rows,
  loading,
  errorText,
}: {
  label: string;
  rows: { key: string; name: string; meta: string; onPress: () => void }[];
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
      {rows.length > 0 && (
        <View style={styles.resultsBox}>
          {rows.slice(0, 6).map((row) => (
            <Pressable
              key={row.key}
              onPress={row.onPress}
              style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
            >
              <Text style={styles.resultName}>{row.name}</Text>
              <Text style={styles.resultMeta}>{row.meta}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function NumericField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.numericField}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.textInput, styles.numericTextInput]}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={colors.textTertiary}
        selectTextOnFocus
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
  },
  title: {
    ...type.h2,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  searchInput: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  resultsGroup: {
    marginBottom: spacing.xs,
  },
  resultsGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  resultsGroupLabel: {
    ...type.sectionLabel,
    color: colors.textTertiary,
  },
  resultsError: {
    ...type.small,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  emptyState: {
    ...type.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  resultsBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  resultRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  resultRowPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  resultName: {
    ...type.body,
    color: colors.text,
  },
  resultMeta: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
  },
  label: {
    ...type.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  textInput: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  numericTextInput: {
    ...numeric,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  numericField: {
    flex: 1,
  },
  saveToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  actionsRight: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginLeft: 'auto',
  },
  cancelButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  cancelButtonPressed: {
    backgroundColor: colors.surface,
  },
  cancelText: {
    ...type.body,
    color: colors.textSecondary,
  },
  deleteButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  deleteButtonPressed: {
    backgroundColor: colors.surface,
  },
  deleteText: {
    ...type.body,
    color: colors.textSecondary,
  },
  saveButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  saveButtonPressed: {
    opacity: 0.85,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  saveText: {
    ...type.bodyStrong,
    color: colors.background,
  },
});
