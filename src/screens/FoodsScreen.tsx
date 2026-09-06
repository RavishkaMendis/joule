// ═══════════════════════════════════════════════════════════════════════
// FoodsScreen — PRD §9.4: "Two tabs. Saved foods (searchable,
// frequency-ranked). Active pots (name, kcal/g, remaining grams, tap to
// log a serving)."
//
// Saved-food search/ranking is entirely foodRepo.searchSavedFood (already
// orders by use_count DESC, last_used DESC — frequency-ranked per the
// PRD). Pot serving/decrement/auto-archive logic is entirely potRepo
// (task brief: "wire it up; do not reimplement") via src/lib/potActions.ts.
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

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Tab = 'foods' | 'pots';

export function FoodsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('foods');
  const [query, setQuery] = useState('');
  const [foods, setFoods] = useState<SavedFoodRow[]>([]);
  const [pots, setPots] = useState<PotRow[]>([]);

  const loadFoods = useCallback(async (q: string) => {
    const db = await getDatabase();
    const rows = await foodRepo.searchSavedFood(db, q.trim());
    setFoods(rows);
  }, []);

  const loadPots = useCallback(async () => {
    const db = await getDatabase();
    const rows = await potRepo.getActivePots(db);
    setPots(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Re-run with whatever query is currently typed. Deliberately reads
      // `query` from the enclosing closure rather than listing it as a
      // dependency: re-running search on every focus with a stale query is
      // fine (cheap, local-only), and handleQueryChange already re-runs the
      // search on every keystroke independently of this focus effect.
      void loadFoods(query);
      void loadPots();
    }, [loadFoods, loadPots])
  );

  const handleQueryChange = (text: string) => {
    setQuery(text);
    void loadFoods(text);
  };

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
            renderItem={({ item }) => <SavedFoodRowItem food={item} />}
            ListEmptyComponent={<Text style={styles.emptyText}>No saved foods yet — they&apos;re added from the food entry screen.</Text>}
            // The search TextInput above keeps focus (and the keyboard up)
            // while this list is scrolled/tapped. Without this prop RN's
            // default ("never") means the FIRST tap on anything in the
            // list only dismisses the keyboard rather than reaching the
            // list — so any future tappable affordance on a saved-food row
            // (or a tap that lands on the list while typing) would need a
            // second tap to register. "handled" matches the app's other
            // search-above-list screens (see FoodEntryScreen's ScrollView).
            keyboardShouldPersistTaps="handled"
          />
        </>
      ) : (
        <>
          <Pressable style={styles.createPotButton} onPress={() => navigation.navigate('PotCreate')} accessibilityRole="button">
            <Text style={styles.createPotButtonText}>+ New pot</Text>
          </Pressable>
          <FlatList
            data={pots}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <PotRowItem pot={item} onTap={() => navigation.navigate('PotLogServing', { potId: item.id })} />
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>No active pots — cook a batch and log it here.</Text>}
          />
        </>
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

function SavedFoodRowItem({ food }: { food: SavedFoodRow }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMiddle}>
        <Text style={styles.rowName}>{food.name}</Text>
        <Text style={styles.rowMeta}>
          {Math.round(food.kcal_per_100g)} kcal/100g · used {food.use_count}×
        </Text>
      </View>
      <Text style={styles.rowGrams}>{Math.round(food.default_grams)}g</Text>
    </View>
  );
}

function PotRowItem({ pot, onTap }: { pot: PotRow; onTap: () => void }) {
  // A pot can now exist with no cooked weight yet (task brief #1: created
  // from ingredients alone) — never show a fabricated 0.00 kcal/g or 0g
  // left, say so honestly instead.
  return (
    <Pressable onPress={onTap} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} accessibilityRole="button">
      <View style={styles.rowMiddle}>
        <Text style={styles.rowName}>{pot.name}</Text>
        <Text style={styles.rowMeta}>{pot.kcal_per_g !== null ? `${pot.kcal_per_g.toFixed(2)} kcal/g` : 'Not yet weighed'}</Text>
      </View>
      <Text style={styles.rowGrams}>{pot.remaining_g !== null ? `${Math.round(pot.remaining_g)}g left` : ''}</Text>
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
