// ═══════════════════════════════════════════════════════════════════════
// TodayScreen — PRD §9.1, the app's landing screen.
//
// Layout order follows the PRD's spec nearly verbatim:
//   1. Date header (task addition: previous/next + calendar picker)
//   2. Status block (headline kcal, remaining, PCF, TDEE+trend, and a
//      permanent "Weight" row — task addition: the only route into
//      WeightEntryScreen used to be the prompt below, which only shows
//      up once a day and disappears the moment something is logged. The
//      row in StatusBlock is the second, always-there door: same
//      selectedDate, works for both adding and correcting a reading.)
//   3. Weight prompt (only if no reading logged yet for the SELECTED day, PRD §9.6)
//   4. Quick-add chips (PRD §9.1's "highest value-per-line-of-code")
//   5. Entry list (selected day's items, tap to edit, swipe to delete)
//   6. FAB (tap for the input-method menu — PRD §9.1 originally also
//      specified "hold for voice"; voice logging has since been removed)
//
// Wiring constraint (task brief, the most important one): this screen
// reads `targets` from useEngine's stored snapshot and NEVER calls
// computeTargets itself. It only calls computeTDEE (via useEngine) for
// the live TDEE/trend display — that call is cheap/pure and safe to run
// on every load, unlike targets which only change at the weekly check-in.
//
// Date navigation (task addition): `selectedDate` defaults to today and
// is the single source of truth for every date-scoped read/write on this
// screen (entries, quick-add logging, the weight prompt) — no
// special-casing "today" vs "a past day" anywhere below; the repos
// already thread `date` throughout. `clampToToday` (dateNav.ts) is the
// one choke point preventing the selected date from ever crossing into
// the future, since a future-dated intake row would corrupt the TDEE
// engine's daily axis.
//
// The engine/targets (`engine.tdee`, `engine.targets`) are read from
// useEngine exactly as before and are NOT re-derived per selected date —
// PRD §5: targets change only at the weekly check-in, and the TDEE
// display is a live "right now" read of the whole history, not a
// per-day-view computation. Browsing to a past day changes which day's
// entries/status you're looking at; it does not change what "the current
// TDEE" means.
//
// Weekly check-in gating (coordinator-flagged audit): the check-in
// banner/entry point is shown ONLY when `selectedDate` is today. See the
// decision note below `checkInDue` for why.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/navigation';
import { colors, radii, spacing, type, minTouchTarget } from '../lib/theme';
import { getDatabase } from '../lib/db';
import { useEngine } from '../lib/useEngine';
import { todayLocalISO } from '../lib/localDate';
import { clampToToday } from '../lib/dateNav';
import * as foodRepo from '../db/repositories/foodRepo';
import * as weightRepo from '../db/repositories/weightRepo';
import type { FoodEntryRow, MealType, SavedFoodRow } from '../db/types';
import { StatusBlock } from '../components/StatusBlock';
import { QuickAddChips } from '../components/QuickAddChips';
import { EntryList } from '../components/EntryList';
import { Fab } from '../components/Fab';
import { InputMethodMenu, type InputMethod } from '../components/InputMethodMenu';
import { WeightPrompt } from '../components/WeightPrompt';
import { DateHeader } from '../components/DateHeader';
// Background scan jobs (task brief: "the scanning can take a minute" —
// src/lib/captureJobs). This component owns its own runtime wiring
// entirely; rendering it is the only integration point Today needs.
import { CaptureJobsIndicator } from '../components/capture/CaptureJobsIndicator';
import { useCaptureJobsList } from '../lib/captureJobs';
import { logQuickAdd, deleteFoodEntry } from '../lib/foodEntryActions';
// Meal-prep (pot) workflow discoverability (task brief) — self-contained,
// fetches its own active-pots list, so this screen only ever gains one
// import and one render line here, never any new state of its own.
import { ActivePotsRow } from '../components/pot/ActivePotsRow';

const QUICK_ADD_LIMIT = 6;
/**
 * A check-in is "due" for the banner nudge once ~7 days have passed since
 * the last accepted snapshot (or immediately, if there has never been
 * one). This is ONLY a UI nudge to open WeeklyCheckInScreen — it never
 * auto-accepts anything itself (PRD §14 open question, deliberately left
 * unresolved per the task brief: no auto-accept-after-N-days behaviour
 * exists anywhere in this codebase).
 */
const CHECK_IN_DUE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Minimum logged intake days (out of the engine's history window) before
 * the check-in banner is allowed to appear at all — fixes the "banner on
 * a brand-new install with zero data" defect. Rule chosen: a check-in with
 * fewer than 3 logged days has nothing meaningful to review yet (the
 * engine itself won't attempt a measured TDEE with less than 2 logged
 * days of intake plus 2 weight readings — see hasEnoughForMeasured in
 * src/engine/tdee.ts), so 3 gives a one-day margin over that floor rather
 * than firing the instant the engine's own minimum is technically met.
 * This is a UI nudge gate only; it does not change what the check-in
 * screen itself is willing to compute.
 */
const CHECK_IN_MIN_LOGGED_DAYS = 3;

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function TodayScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const engine = useEngine();
  const jobs = useCaptureJobsList();
  const [entries, setEntries] = useState<FoodEntryRow[]>([]);
  const [quickAdd, setQuickAdd] = useState<SavedFoodRow[]>([]);
  // The full reading (not just a boolean) so StatusBlock's permanent
  // weight control can display the actual figure, not merely whether one
  // exists. `hasWeightForSelectedDate` stays derived from this rather
  // than tracked separately, so the two can never disagree.
  const [selectedDateWeightKg, setSelectedDateWeightKg] = useState<number | null>(null);
  const hasWeightForSelectedDate = selectedDateWeightKg !== null;
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const today = todayLocalISO();
  // The date this screen is currently showing — defaults to today, and
  // "Today" is always one tap away via DateHeader regardless of how far
  // back this has been navigated (task requirement). Every load below
  // reads/writes against `selectedDate`, never a hardcoded `today` — the
  // one exception is capture routes (barcode/label/photo), which
  // intentionally always log against today; see handleSelectInput below.
  const [selectedDate, setSelectedDate] = useState(today);
  const isViewingToday = selectedDate === today;

  // Single choke point: every date-nav interaction (arrows, calendar tap)
  // passes through here, so the selected date can never end up in the
  // future no matter which control produced the candidate value — a
  // future-dated intake row would corrupt the TDEE engine's daily axis.
  const changeSelectedDate = useCallback((candidate: string) => {
    setSelectedDate(clampToToday(candidate));
  }, []);

  // Each input path (PRD §7) is just a different way to populate the one
  // shared ConfirmSheet, so this only picks a capture route — nothing
  // here writes to the log.
  //
  // Every capture route, including barcode/label/photo, threads
  // `selectedDate` through (task correction: a previous pass here logged
  // every camera route against today unconditionally, reasoning they
  // were "live capture only" — that's wrong. Photographing a nutrition
  // label for something eaten yesterday is a perfectly ordinary backfill
  // action, and PRD §10 promises "everything editable forever, including
  // past days." Silently landing those on today would be a data-integrity
  // bug the user only notices days later. Each capture screen shows a
  // "Logging to <date>" line whenever `selectedDate` isn't today, so this
  // is never a SILENT change of date — see CaptureHint's dateLabel usage
  // in those screens). Voice logging (a fifth capture route) was removed —
  // the owner didn't use it; see InputMethodMenu.tsx.
  const handleSelectInput = useCallback(
    (method: InputMethod) => {
      setMenuOpen(false);
      switch (method) {
        case 'pot':
          // Meal prep is not date-threaded like the other capture routes:
          // a pot itself isn't logged against a day, and PotQuickAccess
          // always logs a serving against TODAY specifically (matching
          // the live "weigh what's in front of you right now" nature of
          // the task).
          navigation.navigate('PotQuickAccess');
          break;
        case 'barcode':
          navigation.navigate('BarcodeScan', { date: selectedDate });
          break;
        case 'label':
          navigation.navigate('LabelScan', { date: selectedDate });
          break;
        case 'photo':
          navigation.navigate('MealPhoto', { date: selectedDate });
          break;
        case 'manual':
          navigation.navigate('FoodEntry', { date: selectedDate });
          break;
      }
    },
    [navigation, selectedDate]
  );

  const hasEnoughHistoryForCheckIn = (engine.tdee?.loggedDaysInWindow ?? 0) >= CHECK_IN_MIN_LOGGED_DAYS;
  // Decision (coordinator-flagged audit): the weekly check-in ALWAYS
  // reviews the trailing week ending TODAY, never a hypothetical week
  // ending on whatever past day this screen happens to be showing.
  // WeeklyCheckInScreen computes off todayLocalISO() unconditionally and
  // takes no date param — that is intentional, not an oversight: PRD §5
  // frames the check-in as a real-world weekly event ("fires Sunday
  // morning"), and computeTDEE/computeTargets read the actual accumulated
  // history regardless of which day Today's UI is scrolled to, so "the
  // week ending on a past day I'm browsing" isn't a meaningful question
  // the engine even answers differently. To keep that unambiguous rather
  // than silently surprising, the banner/entry point to WeeklyCheckIn is
  // only ever shown while viewing today — browsing to a past day hides
  // it entirely rather than opening it and having it quietly ignore the
  // browsed date.
  const checkInDue =
    isViewingToday &&
    hasEnoughHistoryForCheckIn &&
    (engine.targets === null || Date.now() - engine.targets.acceptedAt >= CHECK_IN_DUE_MS);

  const loadDayData = useCallback(async () => {
    const db = await getDatabase();
    const [dayEntries, candidates, weightForDay] = await Promise.all([
      foodRepo.getEntriesForDate(db, selectedDate),
      foodRepo.getQuickAddCandidates(db, QUICK_ADD_LIMIT),
      weightRepo.getByDate(db, selectedDate),
    ]);
    setEntries(dayEntries);
    setQuickAdd(candidates);
    setSelectedDateWeightKg(weightForDay?.weight_kg ?? null);
  }, [selectedDate]);

  useEffect(() => {
    void loadDayData();
  }, [loadDayData]);

  // Re-pull the selected day's entries/quick-add list and re-run the
  // (cheap, pure) TDEE computation whenever this screen regains focus —
  // e.g. returning from the food/weight entry modals after a save.
  const { refresh: refreshEngine } = engine;
  useFocusEffect(
    useCallback(() => {
      void loadDayData();
      void refreshEngine();
    }, [loadDayData, refreshEngine])
  );

  const totals = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      protein_g: acc.protein_g + e.protein_g,
      carbs_g: acc.carbs_g + e.carbs_g,
      fat_g: acc.fat_g + e.fat_g,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

  const handleQuickAdd = useCallback(
    async (food: SavedFoodRow) => {
      const db = await getDatabase();
      await logQuickAdd(db, food, selectedDate);
      await loadDayData();
      await refreshEngine();
    },
    [selectedDate, loadDayData, refreshEngine]
  );

  const handleDelete = useCallback(
    async (entry: FoodEntryRow) => {
      const db = await getDatabase();
      await deleteFoodEntry(db, entry.id);
      await loadDayData();
      await refreshEngine();
    },
    [loadDayData, refreshEngine]
  );

  // Deleting a collapsed meal row deletes every entry in its group in one
  // go — foodRepo.deleteGroup already triggers intakeRepo.recomputeDay
  // for every affected date, so this must NOT call recomputeDay itself.
  const handleDeleteGroup = useCallback(
    async (mealGroupId: string) => {
      const db = await getDatabase();
      await foodRepo.deleteGroup(db, mealGroupId);
      await loadDayData();
      await refreshEngine();
    },
    [loadDayData, refreshEngine]
  );

  // Reassigning meal type after the fact (task requirement — PRD §10
  // "everything editable forever"). Not on the logging fast path, so a
  // plain sequential loop over foodRepo.updateEntry is fine here even for
  // a multi-item meal-photo group — foodRepo already re-triggers
  // intakeRepo.recomputeDay per call, which is a harmless no-op for the
  // day's totals since meal_type doesn't feed the TDEE engine or
  // day_intake's kcal/macro columns at all.
  const handleChangeMealType = useCallback(
    async (entryIds: string[], mealType: MealType) => {
      const db = await getDatabase();
      for (const id of entryIds) {
        await foodRepo.updateEntry(db, id, { meal_type: mealType });
      }
      await loadDayData();
    },
    [loadDayData]
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDayData();
    await refreshEngine();
    setRefreshing(false);
  }, [loadDayData, refreshEngine]);

  // First-run guidance: a brand-new install has no targets and no entries
  // yet — instead of a bare "0" and dead space, tell the user the two
  // concrete next actions that get the engine started (PRD §9.1's 10-second
  // test starts paying off only once there's something logged; PRD §9.6
  // wants a daily weigh-in habit from day one). Only shown while viewing
  // today — browsing to an empty past day is not "first run", it's just
  // a day with nothing logged, and must render neutrally (PRD §10: no
  // guilt) rather than re-showing onboarding copy.
  const isFirstRun = isViewingToday && engine.targets === null && entries.length === 0 && !engine.loading;

  // ─────────────────────────────────────────────────────────────────────
  // One next action (UI redesign brief): Today had accumulated four
  // candidates for "the thing to do next" — an in-flight capture result,
  // the weight prompt, the check-in banner, and the first-run welcome —
  // all capable of stacking on top of each other. Only the single
  // highest-priority one renders at a time; everything else on the
  // screen (quick-add, active pots, the entry list) stays reachable and
  // unaffected by this.
  //
  // Priority, highest first:
  //   1. An in-flight capture result — a scan finished while the user was
  //      elsewhere and is now sitting there wanting a decision. Most
  //      time-sensitive: it's the tail end of an action already started.
  //   2. The weight prompt — a same-day habit nudge, and the input the
  //      TDEE engine most needs on a day it's missing.
  //   3. The weekly check-in — due at most weekly, never daily.
  //   4. The first-run welcome — only relevant once, and only when there
  //      is truly nothing else to show.
  //
  // `hasCaptureResult` reads the same `useCaptureJobsList` store
  // CaptureJobsIndicator itself subscribes to; CaptureJobsIndicator stays
  // unconditionally mounted below regardless of this (it owns its own
  // runtime wiring — store hydration, the notification-tap listener —
  // and already renders nothing when there are no jobs), so this is only
  // used to make the OTHER three defer to it, never to gate its mount.
  const hasCaptureResult = jobs.length > 0;
  const nextAction: 'capture' | 'weight' | 'checkin' | 'firstrun' | null = hasCaptureResult
    ? 'capture'
    : !hasWeightForSelectedDate
      ? 'weight'
      : checkInDue
        ? 'checkin'
        : isFirstRun
          ? 'firstrun'
          : null;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + spacing.md }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.textSecondary} />}
      >
        <View style={styles.headerRow}>
          <Text style={styles.header}>Today</Text>
          <Pressable
            onPress={() => navigation.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={8}
            style={styles.settingsTarget}
          >
            <Text style={styles.settingsLink}>Settings</Text>
          </Pressable>
        </View>

        <View style={styles.tightSpacer} />
        <DateHeader date={selectedDate} onChangeDate={changeSelectedDate} />

        {/* CaptureJobsIndicator stays unconditionally mounted — it owns its
            own runtime wiring (job-store hydration, the notification-tap
            listener) and already renders nothing when there are no jobs.
            It also happens to be priority 1 of the "one next action" group
            below: whenever it has something to show, `nextAction` above
            has already deferred every other candidate to it. */}
        <CaptureJobsIndicator />

        {/* One next action (redesign brief): at most one of these three
            renders at a time — see `nextAction` above for the priority
            order and why. A single blockSpacer separates this slot from
            the date header above it since it's a related nudge tied to
            "today", not yet a new section; StatusBlock below gets the
            larger sectionSpacer regardless of whether anything rendered
            here, so the layout doesn't jump when there's nothing to show. */}
        {nextAction === 'checkin' && (
          <>
            <View style={styles.blockSpacer} />
            <Pressable
              onPress={() => navigation.navigate('WeeklyCheckIn')}
              style={({ pressed }) => [styles.checkInBanner, pressed && styles.checkInBannerPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.checkInBannerText}>Weekly check-in is ready — see this week&apos;s numbers</Text>
            </Pressable>
          </>
        )}

        {nextAction === 'firstrun' && (
          <>
            <View style={styles.blockSpacer} />
            <View style={styles.firstRunBanner}>
              <Text style={styles.firstRunTitle}>Welcome to Joule</Text>
              <Text style={styles.firstRunBody}>
                Two things get the engine started: log your first meal below, and weigh in each morning. There&apos;s
                no target yet — that arrives after your first weekly check-in, once there&apos;s a week of data to
                measure.
              </Text>
            </View>
          </>
        )}

        {/* Status group: the day's headline numbers are the single most
            important thing on this screen, so it gets the biggest gap
            above it (sectionSpacer) to separate it from date/banner chrome,
            and the weight prompt sits close beneath it (tightSpacer) since
            it's a related same-group nudge, not a new section. */}
        <View style={styles.sectionSpacer} />
        <StatusBlock
          totals={totals}
          targets={engine.targets}
          tdee={engine.tdee}
          weightKg={selectedDateWeightKg}
          onLogWeight={() => navigation.navigate('WeightEntry', { date: selectedDate })}
        />

        {nextAction === 'weight' && (
          <>
            <View style={styles.tightSpacer} />
            <WeightPrompt onPress={() => navigation.navigate('WeightEntry', { date: selectedDate })} />
          </>
        )}

        {/* Action group: quick-add is "the highest value-per-line-of-code
            element in the app" (PRD §9.1) — a clear gap sets it apart as
            its own group rather than a continuation of the status block. */}
        <View style={styles.sectionSpacer} />
        <QuickAddChips candidates={quickAdd} onTap={(food) => void handleQuickAdd(food)} />
        <ActivePotsRow />

        {/* Log group: today's entries are a review/reference list, the
            quietest section on the screen — same large gap to read as a
            distinct group, not fused to the quick-add chips above it. */}
        <View style={styles.sectionSpacer} />
        <EntryList
          entries={entries}
          onEdit={(entry) => navigation.navigate('FoodEntry', { date: entry.date, entryId: entry.id })}
          onDelete={(entry) => void handleDelete(entry)}
          onDeleteGroup={(mealGroupId) => void handleDeleteGroup(mealGroupId)}
          onChangeMealType={(entryIds, mealType) => void handleChangeMealType(entryIds, mealType)}
          hasQuickAdd={quickAdd.length > 0}
        />

        <View style={styles.bottomPadding} />
      </ScrollView>

      <Fab onPress={() => setMenuOpen(true)} />
      <InputMethodMenu visible={menuOpen} onSelect={handleSelectInput} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  header: {
    ...type.h1,
    color: colors.text,
  },
  settingsTarget: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  settingsLink: {
    ...type.body,
    color: colors.textSecondary,
  },
  checkInBanner: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  checkInBannerPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  checkInBannerText: {
    ...type.caption,
    color: colors.text,
  },
  firstRunBanner: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  firstRunTitle: {
    ...type.bodyStrong,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  firstRunBody: {
    ...type.caption,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  // Groups related content (e.g. the weight prompt directly under the
  // status block it's a nudge for) — deliberately smaller than
  // sectionSpacer so the two read as one group, not two sections.
  tightSpacer: {
    height: spacing.sm,
  },
  // Separates a related-but-distinct block from what's above it (e.g. the
  // one-next-action slot from the date header) — bigger than tightSpacer
  // (same-group), smaller than sectionSpacer (new section).
  blockSpacer: {
    height: spacing.lg,
  },
  // Separates distinct sections (status -> quick-add -> entry list) so
  // the screen reads as grouped content instead of one even stack.
  sectionSpacer: {
    height: spacing.xl,
  },
  bottomPadding: {
    height: 96,
  },
});
