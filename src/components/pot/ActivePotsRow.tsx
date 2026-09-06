// ═══════════════════════════════════════════════════════════════════════
// ActivePotsRow — surfaces active pots on Today as one-tap serving
// entries (task brief "Discoverability": "Surface active pots on Today
// as one-tap serving entries near the quick-add chips").
//
// Self-contained: fetches its own data (active pots) and re-fetches on
// focus, exactly like QuickAddChips' candidates are fetched by
// TodayScreen — except here TodayScreen is off-limits to restructure, so
// this component owns its own load/refresh lifecycle instead of taking
// pots as a prop. TodayScreen only needs to render `<ActivePotsRow />`
// once, near QuickAddChips, and never gets bigger.
//
// Renders nothing (not even a header) when there are no active pots, so a
// household that has never made one sees no trace of this feature on
// Today — same "quiet by default" rule QuickAddChips already follows.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../lib/navigation';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../../lib/theme';
import { getDatabase } from '../../lib/db';
import * as potRepo from '../../db/repositories/potRepo';
import type { PotRow } from '../../db/types';
import { potConfidenceSummary, potRemainingStatus } from '../../lib/potActions';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ActivePotsRow() {
  const navigation = useNavigation<Nav>();
  const [pots, setPots] = useState<PotRow[]>([]);

  const load = useCallback(async () => {
    const db = await getDatabase();
    const rows = await potRepo.getActivePots(db);
    setPots(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (pots.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Active pots</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {pots.map((pot) => {
          // The pot's own honesty (task brief), at a glance: quick-glance
          // quality-check before tapping in to log a serving.
          const confidence = potConfidenceSummary(pot);
          const confidencePct = confidence.totalKcal > 0 ? Math.round(confidence.exactEnergyFraction * 100) : null;
          // Task brief "running low is a state, not a cliff": a pot that's
          // hit (or been floored at) zero stays right here rather than
          // vanishing — see potActions.potRemainingStatus's own doc.
          const remaining = potRemainingStatus(pot);
          return (
            <Pressable
              key={pot.id}
              onPress={() => navigation.navigate('PotLogServing', { potId: pot.id })}
              style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Log a serving from ${pot.name}, ${remaining.label}${confidencePct !== null ? `, ${confidencePct}% of calories from a scanned or database match` : ''}`}
            >
              <Text style={styles.chipName} numberOfLines={1}>
                {pot.name}
              </Text>
              <Text style={styles.chipMeta}>
                {remaining.label}
                {confidencePct !== null ? ` · ${confidencePct}% exact` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
  },
  label: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  row: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  chip: {
    minHeight: minTouchTarget,
    minWidth: 120,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  chipName: {
    ...type.bodyStrong,
    color: colors.text,
  },
  chipMeta: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
    marginTop: 2,
  },
});
