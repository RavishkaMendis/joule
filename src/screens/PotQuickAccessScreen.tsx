// ═══════════════════════════════════════════════════════════════════════
// PotQuickAccessScreen — the FAB's "Meal prep" entry point (task brief
// "Discoverability": "Add 'Meal prep' to the FAB's input-method menu
// alongside voice/barcode/photo").
//
// This is the fix for "the actual reason he never used it": pot logging
// used to be buried behind a button on the Foods tab. Now it's one FAB
// tap away, and this screen decides where that tap actually needs to
// land so it never costs more than the one extra tap of showing a list:
//   - Zero active pots  -> straight to PotCreate (nothing to serve yet).
//   - One active pot    -> straight to PotLogServing for it (this IS
//                          the "2-3 taps: tap pot, weigh, done" promise —
//                          the FAB tap replaces "find the Foods tab, find
//                          the Pots sub-tab, tap the pot").
//   - 2+ active pots     -> a short list to pick one (or start a new pot),
//                          shown here rather than silently guessing which
//                          one the user means.
// Every one of these is a `replace`, not a `navigate` — this screen is a
// router, not a destination; it should never sit on the back stack.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/navigation';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as potRepo from '../db/repositories/potRepo';
import type { PotRow } from '../db/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'PotQuickAccess'>;

export function PotQuickAccessScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [pots, setPots] = useState<PotRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await getDatabase();
      const active = await potRepo.getActivePots(db);
      if (cancelled) return;

      if (active.length === 0) {
        navigation.replace('PotCreate');
        return;
      }
      if (active.length === 1) {
        navigation.replace('PotLogServing', { potId: active[0].id });
        return;
      }
      setPots(active);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  // Zero/one-pot cases replace immediately above and never render this
  // list at all — it only ever shows for 2+ active pots, while the
  // lookup itself is in flight (`pots === null`) it's a blank screen for
  // an instant rather than a flash of an empty list.
  if (pots === null) return <View style={styles.screen} />;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom }]}>
      <Text style={styles.title}>Meal prep</Text>
      <Text style={styles.subtitle}>Log a serving from an active pot, or start a new one.</Text>
      <FlatList
        data={pots}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.replace('PotLogServing', { potId: item.id })}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
          >
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{item.name}</Text>
              {/* Task brief #1: a pot created from ingredients alone has
                  no kcal_per_g/remaining_g yet — never show a fabricated
                  0.00 kcal/g, say so honestly instead. */}
              <Text style={styles.rowMeta}>{item.kcal_per_g !== null ? `${item.kcal_per_g.toFixed(2)} kcal/g` : 'Not yet weighed'}</Text>
            </View>
            <Text style={styles.rowGrams}>{item.remaining_g !== null ? `${Math.round(item.remaining_g)}g left` : ''}</Text>
          </Pressable>
        )}
      />
      <Pressable onPress={() => navigation.replace('PotCreate')} style={styles.newPotButton} accessibilityRole="button">
        <Text style={styles.newPotButtonText}>+ New pot</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  title: {
    ...type.h1,
    color: colors.text,
  },
  subtitle: {
    ...type.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  list: {
    paddingBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    minHeight: minTouchTarget,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  rowText: {
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
  newPotButton: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  newPotButtonText: {
    ...type.bodyStrong,
    color: colors.accent,
  },
});
