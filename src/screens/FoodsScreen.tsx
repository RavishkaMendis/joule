// ═══════════════════════════════════════════════════════════════════════
// FoodsScreen — PRD §9.4: "Two tabs. Saved foods (searchable,
// frequency-ranked). Active pots (name, kcal/g, remaining grams, tap to
// log a serving)."
//
// Saved-food search/ranking is entirely foodRepo.searchSavedFood (already
// orders by use_count DESC, last_used DESC — frequency-ranked per the
// PRD). Pot serving/decrement logic is entirely potRepo (task brief:
// "wire it up; do not reimplement") via src/lib/potActions.ts.
//
// REWORK ("the pots going to zero thing" — see potRepo.ts's own header for
// the full reasoning): the Pots tab is now filterable Active/Finished
// rather than a single always-active list — an archived pot used to be
// unreachable from any screen, which is the discoverability half of the
// bug. Reopening a finished pot or duplicating it for "cook this again"
// both happen from PotLogServingScreen, which every row here (in either
// filter) navigates to.
//
// SAVED-FOOD ROW TAP (task brief: "how to add saved food to my current
// day?" — the answer used to be "you can't"): a saved-food row is now
// tappable, matching the Pots tab's own row-interaction pattern in this
// same screen (Pressable row -> confirmation surface) rather than
// inventing a different one. It opens the ONE shared `ConfirmSheet` (PRD
// §7) via `pendingEntryFromSavedFood` so grams can be adjusted before
// saving — `default_grams` is only a captured guess from whenever the
// food was first logged — rather than committing to it blindly the way
// the QuickAddChips one-tap path deliberately still does.
//
// WHAT DATE DOES IT LOG AGAINST? Foods is a bottom TAB (`Foods: undefined`
// in navigation.ts's TabParamList — no params at all), a sibling of
// Today, not a screen Today pushes with a `date` param the way FoodEntry/
// BarcodeScan/etc. all are. Today's "day currently being viewed" is
// `selectedDate`, plain `useState` local to TodayScreen's own component
// instance (see that screen) — it is not threaded through navigation
// params, a route, or any shared store, so there is no cross-screen
// "day the app is currently showing" for this screen to read. Building
// one would mean either adding shared state that TodayScreen writes to
// (touching a screen outside this task's scope and risking collision
// with the other agents working in this codebase right now) or threading
// a param through `navigation.ts`/`App.tsx`, both explicitly off-limits
// for this change. Given that, and given Foods itself has no day-based
// view of its own (it's a library, not a daily log), the correct source
// of truth reachable from here is `todayLocalISO()` — not a silent lazy
// default, but the only "day this screen is showing" that actually
// exists for it. If a shared "day Today is browsing" concept is added
// later, this is the one place that would need to start reading it.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/navigation';
import { colors, numeric, radii, spacing, type, minTouchTarget } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as foodRepo from '../db/repositories/foodRepo';
import * as potRepo from '../db/repositories/potRepo';
import type { SavedFoodRow, PotRow } from '../db/types';
import { potRemainingStatus } from '../lib/potActions';
import { pendingEntryFromSavedFood, recordSavedFoodUse } from '../lib/foodEntryActions';
import { todayLocalISO } from '../lib/localDate';
import { ConfirmSheet } from '../components/ConfirmSheet';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Tab = 'foods' | 'pots';
/**
 * Task brief #3 ("an archived pot is a recipe... reachable and
 * reopenable"): pots was previously a single always-active list with no
 * way to see a finished batch at all. This is the "section in Foods" half
 * of the fix — the other half (reopen / cook again) lives in
 * PotLogServingScreen, which this screen navigates every row to either
 * way.
 */
type PotFilter = 'active' | 'finished';

export function FoodsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('foods');
  const [potFilter, setPotFilter] = useState<PotFilter>('active');
  const [query, setQuery] = useState('');
  const [foods, setFoods] = useState<SavedFoodRow[]>([]);
  const [pots, setPots] = useState<PotRow[]>([]);
  // The saved food currently open in the confirmation sheet, or null when
  // it's closed. Kept as the whole row (not just a built PendingEntry) so
  // the confirm handler below can still reach `.id` for the use_count
  // bump — see this file's header for why that bump can't happen inside
  // ConfirmSheet itself.
  const [confirmFood, setConfirmFood] = useState<SavedFoodRow | null>(null);

  const loadFoods = useCallback(async (q: string) => {
    const db = await getDatabase();
    const rows = await foodRepo.searchSavedFood(db, q.trim());
    setFoods(rows);
  }, []);

  const loadPots = useCallback(async (filter: PotFilter) => {
    const db = await getDatabase();
    const rows = filter === 'active' ? await potRepo.getActivePots(db) : await potRepo.getArchivedPots(db);
    setPots(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Re-run with whatever query/filter is currently active. Deliberately
      // reads them from the enclosing closure rather than listing as
      // dependencies: re-running on every focus with stale values is fine
      // (cheap, local-only), and handleQueryChange/setPotFilter already
      // re-run independently of this focus effect.
      void loadFoods(query);
      void loadPots(potFilter);
    }, [loadFoods, loadPots])
  );

  const handleQueryChange = (text: string) => {
    setQuery(text);
    void loadFoods(text);
  };

  const handlePotFilterChange = (filter: PotFilter) => {
    setPotFilter(filter);
    void loadPots(filter);
  };

  // Opens the shared ConfirmSheet for a tapped saved-food row (task brief:
  // "make a saved-food row tappable"). Building the PendingEntry happens
  // in the render below (pendingEntryFromSavedFood is pure/cheap) so it
  // always reflects the row currently in `confirmFood`.
  const handleFoodTap = useCallback((food: SavedFoodRow) => {
    setConfirmFood(food);
  }, []);

  const handleConfirmFoodLogged = useCallback(async () => {
    if (!confirmFood) return;
    const db = await getDatabase();
    // ConfirmSheet has already written the food_entry itself by the time
    // onConfirm fires (see its own header doc) — this only does the part
    // it can't: bumping the ORIGINATING saved_food row's use_count, since
    // ConfirmSheet has no notion that this PendingEntry came from one.
    await recordSavedFoodUse(db, confirmFood.id);
    setConfirmFood(null);
    // Refresh so "used Nx" and frequency ranking reflect the new count.
    void loadFoods(query);
  }, [confirmFood, loadFoods, query]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.header}>Foods &amp; Pots</Text>

      <View style={styles.tabRow}>
        <TabButton label="Saved foods" active={tab === 'foods'} onPress={() => setTab('foods')} />
        <TabButton label="Pots" active={tab === 'pots'} onPress={() => setTab('pots')} />
      </View>

      {tab === 'foods' ? (
        <>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={handleQueryChange}
            placeholder="Search your foods…"
            placeholderTextColor={colors.textTertiary}
          />
          <FlatList
            data={foods}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => <SavedFoodRowItem food={item} onTap={() => handleFoodTap(item)} />}
            ListEmptyComponent={<Text style={styles.emptyText}>No saved foods yet — they&apos;re added from the food entry screen.</Text>}
            // The search TextInput above keeps focus (and the keyboard up)
            // while this list is scrolled/tapped. Without this prop RN's
            // default ("never") means the FIRST tap on anything in the
            // list only dismisses the keyboard rather than reaching the
            // list — so tapping a saved-food row (now that it opens the
            // confirmation sheet — see this file's header) or a tap that
            // lands on the list while typing would need a second tap to
            // register. "handled" matches the app's other search-above-
            // list screens (see FoodEntryScreen's ScrollView).
            keyboardShouldPersistTaps="handled"
          />
        </>
      ) : (
        <>
          <Pressable style={styles.createPotButton} onPress={() => navigation.navigate('PotCreate')} accessibilityRole="button">
            <Text style={styles.createPotButtonText}>+ New pot</Text>
          </Pressable>
          {/* Task brief #3: past (finished) pots are a recipe, not trash —
              this is the "reachable" half of the fix. Reopening or
              duplicating a finished pot both happen from the same
              PotLogServing screen every row here already navigates to. */}
          <View style={styles.potFilterRow}>
            <TabButton label="Active" active={potFilter === 'active'} onPress={() => handlePotFilterChange('active')} />
            <TabButton label="Finished" active={potFilter === 'finished'} onPress={() => handlePotFilterChange('finished')} />
          </View>
          <FlatList
            data={pots}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <PotRowItem pot={item} finished={potFilter === 'finished'} onTap={() => navigation.navigate('PotLogServing', { potId: item.id })} />
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {potFilter === 'active'
                  ? 'No active pots — cook a batch and log it here.'
                  : "No finished pots yet — pots you've finished show up here, ready to reopen or cook again."}
              </Text>
            }
          />
        </>
      )}

      {/* The ONE shared confirmation sheet (PRD §7), reused rather than a
          bespoke dialog — see this file's header for the date/grams/
          confidence reasoning. Rendered as a sibling of the tab content
          (ConfirmSheet is its own full-screen Modal) so mounting/
          unmounting it doesn't disturb the list's scroll position. */}
      {confirmFood && (
        <ConfirmSheet
          entries={[pendingEntryFromSavedFood(confirmFood)]}
          date={todayLocalISO()}
          onConfirm={handleConfirmFoodLogged}
          onCancel={() => setConfirmFood(null)}
          fallbackAction={undefined}
        />
      )}
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tabButton, active && styles.tabButtonActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

// Tappable — matches PotRowItem's own row-interaction pattern in this
// same screen (Pressable row, pressed-state highlight) rather than
// inventing a different one for the Foods tab (task brief).
function SavedFoodRowItem({ food, onTap }: { food: SavedFoodRow; onTap: () => void }) {
  return (
    <Pressable
      onPress={onTap}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Log ${food.name}, ${Math.round(food.default_grams)} grams`}
    >
      <View style={styles.rowMiddle}>
        <Text style={styles.rowName}>{food.name}</Text>
        <Text style={styles.rowMeta}>
          {Math.round(food.kcal_per_100g)} kcal/100g · used {food.use_count}×
        </Text>
      </View>
      <Text style={styles.rowGrams}>{Math.round(food.default_grams)}g</Text>
    </Pressable>
  );
}

function PotRowItem({ pot, finished, onTap }: { pot: PotRow; finished: boolean; onTap: () => void }) {
  // A pot can now exist with no cooked weight yet (task brief #1: created
  // from ingredients alone) — never show a fabricated 0.00 kcal/g, say so
  // honestly instead. Remaining grams go through potRemainingStatus so
  // "0g left" never appears as a bare, precise-looking fact (task brief
  // #3/"the pots going to zero thing") — a FINISHED pot shows that instead
  // of a remaining-grams figure, since finishing is now an explicit action
  // independent of whatever remaining_g happens to be.
  const remaining = potRemainingStatus(pot);
  return (
    <Pressable onPress={onTap} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} accessibilityRole="button">
      <View style={styles.rowMiddle}>
        <Text style={styles.rowName}>{pot.name}</Text>
        <Text style={styles.rowMeta}>{pot.kcal_per_g !== null ? `${pot.kcal_per_g.toFixed(2)} kcal/g` : 'Not yet weighed'}</Text>
      </View>
      {/* rowMeta above already says "Not yet weighed" when kcal_per_g is
          null (which happens exactly when remaining_g is too) — avoid
          saying it twice in the same row. */}
      <Text style={styles.rowGrams}>{finished ? 'Finished' : pot.remaining_g !== null ? remaining.label : ''}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    ...type.h1,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tabButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tabButtonActive: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.accent,
  },
  tabButtonText: {
    ...type.body,
    color: colors.textSecondary,
  },
  tabButtonTextActive: {
    color: colors.text,
  },
  searchInput: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  createPotButton: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  createPotButtonText: {
    ...type.bodyStrong,
    color: colors.accent,
  },
  potFilterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 96,
  },
  emptyText: {
    ...type.body,
    color: colors.textTertiary,
    marginTop: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  rowMiddle: {
    flex: 1,
  },
  rowName: {
    ...type.body,
    color: colors.text,
  },
  rowMeta: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
    marginTop: 2,
  },
  rowGrams: {
    ...type.bodyStrong,
    ...numeric,
    color: colors.text,
  },
});
