// ═══════════════════════════════════════════════════════════════════════
// SupplementsScreen — due-today checklist + manage list (task brief
// "Feature 1 — Supplements").
//
// CLAUDE.md/PRD §10: "No streaks, no guilt, no red." This is the app's
// one checklist-shaped screen, which is exactly where a completion
// affordance is most tempting — deliberately absent here: no streak
// counter, no percentage, no colour change on the row itself beyond a
// plain checkbox fill. An unticked item just sits there, neutral,
// tomorrow it resets with zero memory of today.
//
// Logging a dose (tapping a due-today row) NEVER writes to food_entry by
// itself, no matter what kcal/protein_g the supplement carries — see
// src/lib/supplements/supplementActions.ts's header for why. A
// supplement with macros gets a separate, explicit "+ log as food too"
// action per row, confirmed via Alert before anything is written.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../lib/navigation';
import { colors, numeric, radii, spacing, minTouchTarget, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import { todayLocalISO } from '../lib/localDate';
import * as supplementRepo from '../db/repositories/supplementRepo';
import type { SupplementRow } from '../db/types';
import { buildDueTodayList, type DueTodayItem } from '../lib/supplements/dueToday';
import { parseSchedule, describeSchedule } from '../lib/supplements/schedule';
import { toggleDose, logDoseAndFood, reactivateSupplement, archiveSupplement } from '../lib/supplements/supplementActions';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function hasMacros(s: SupplementRow): boolean {
  return s.kcal > 0 || s.protein_g > 0;
}

export function SupplementsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const today = todayLocalISO();

  const [dueToday, setDueToday] = useState<DueTodayItem[]>([]);
  const [allSupplements, setAllSupplements] = useState<SupplementRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const db = await getDatabase();
    const [supplements, logs] = await Promise.all([
      supplementRepo.listAll(db),
      supplementRepo.getLogsForDate(db, today),
    ]);
    setAllSupplements(supplements);
    setDueToday(buildDueTodayList(supplements, logs, today));
  }, [today]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  const handleToggle = async (supplement: SupplementRow) => {
    setBusyId(supplement.id);
    try {
      const db = await getDatabase();
      await toggleDose(db, supplement.id, today);
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const handleLogAsFood = (supplement: SupplementRow) => {
    Alert.alert(
      'Log as food too?',
      `This adds ${supplement.name} to today's food log: ${supplement.kcal} kcal, ${supplement.protein_g}g protein. This is separate from marking the dose taken — it will count toward today's intake.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Log as food',
          onPress: () =>
            void (async () => {
              setBusyId(supplement.id);
              try {
                const db = await getDatabase();
                await logDoseAndFood(db, supplement, today);
                await reload();
              } finally {
                setBusyId(null);
              }
            })(),
        },
      ]
    );
  };

  const handleToggleActive = async (supplement: SupplementRow) => {
    setBusyId(supplement.id);
    try {
      const db = await getDatabase();
      if (supplement.is_active === 1) {
        await archiveSupplement(db, supplement.id);
      } else {
        await reactivateSupplement(db, supplement.id);
      }
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <FlatList
        data={allSupplements}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <Text style={styles.header}>Supplements</Text>

            <Text style={styles.sectionTitle}>Due today</Text>
            {dueToday.length === 0 ? (
              <Text style={styles.emptyText}>Nothing scheduled today.</Text>
            ) : (
              dueToday.map((item) => (
                <DueRow
                  key={item.supplement.id}
                  item={item}
                  busy={busyId === item.supplement.id}
                  onToggle={() => void handleToggle(item.supplement)}
                  onLogAsFood={hasMacros(item.supplement) ? () => handleLogAsFood(item.supplement) : undefined}
                />
              ))
            )}

            <View style={styles.sectionSpacer} />
            <Pressable
              onPress={() => navigation.navigate('SupplementForm')}
              style={({ pressed }) => [styles.addButton, pressed && styles.rowPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.addButtonText}>+ Add supplement</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>All supplements</Text>
          </>
        }
        renderItem={({ item }) => (
          <ManageRow
            supplement={item}
            busy={busyId === item.id}
            onPress={() => navigation.navigate('SupplementForm', { id: item.id })}
            onToggleActive={() => void handleToggleActive(item)}
          />
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No supplements yet.</Text>}
      />
    </View>
  );
}

function DueRow({
  item,
  busy,
  onToggle,
  onLogAsFood,
}: {
  item: DueTodayItem;
  busy: boolean;
  onToggle: () => void;
  onLogAsFood?: () => void;
}) {
  const { supplement, logged } = item;
  const spec = parseSchedule(supplement.schedule);
  return (
    <View style={styles.dueRow}>
      <Pressable
        onPress={onToggle}
        disabled={busy}
        style={({ pressed }) => [styles.dueRowMain, pressed && styles.rowPressed]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: logged }}
        accessibilityLabel={`${supplement.name}, ${logged ? 'logged' : 'not yet logged'} today`}
      >
        <View style={[styles.checkbox, logged && styles.checkboxChecked]} />
        <View style={styles.dueRowText}>
          <Text style={styles.dueRowName}>{supplement.name}</Text>
          <Text style={styles.dueRowMeta}>
            {supplement.dose}
            {supplement.unit ? ` ${supplement.unit}` : ''} · {describeSchedule(spec)}
          </Text>
        </View>
      </Pressable>
      {onLogAsFood && (
        <Pressable onPress={onLogAsFood} disabled={busy} style={({ pressed }) => [styles.logFoodButton, pressed && styles.rowPressed]}>
          <Text style={styles.logFoodButtonText}>+ food</Text>
        </Pressable>
      )}
    </View>
  );
}

function ManageRow({
  supplement,
  busy,
  onPress,
  onToggleActive,
}: {
  supplement: SupplementRow;
  busy: boolean;
  onPress: () => void;
  onToggleActive: () => void;
}) {
  const spec = parseSchedule(supplement.schedule);
  const archived = supplement.is_active !== 1;
  return (
    <View style={styles.manageRow}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.manageRowMain, pressed && styles.rowPressed]} accessibilityRole="button">
        <Text style={[styles.dueRowName, archived && styles.archivedText]}>{supplement.name}</Text>
        <Text style={styles.dueRowMeta}>
          {supplement.dose}
          {supplement.unit ? ` ${supplement.unit}` : ''} · {describeSchedule(spec)}
          {archived ? ' · Archived' : ''}
        </Text>
      </Pressable>
      <Pressable onPress={onToggleActive} disabled={busy} style={({ pressed }) => [styles.archiveButton, pressed && styles.rowPressed]}>
        <Text style={styles.archiveButtonText}>{archived ? 'Reactivate' : 'Archive'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    ...type.h1,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionSpacer: {
    height: spacing.md,
  },
  emptyText: {
    ...type.caption,
    color: colors.textTertiary,
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  dueRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: minTouchTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginRight: spacing.md,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  dueRowText: {
    flex: 1,
  },
  dueRowName: {
    ...type.body,
    color: colors.text,
  },
  dueRowMeta: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
    marginTop: 2,
  },
  logFoodButton: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  logFoodButtonText: {
    ...type.caption,
    color: colors.accent,
  },
  addButton: {
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  addButtonText: {
    ...type.body,
    color: colors.accent,
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  manageRowMain: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  archivedText: {
    color: colors.textTertiary,
  },
  archiveButton: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  archiveButtonText: {
    ...type.caption,
    color: colors.textSecondary,
  },
});
