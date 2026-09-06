// ═══════════════════════════════════════════════════════════════════════
// RestoreOfferScreen — first-run "restore or start fresh" choice.
//
// Task brief §4: "On a fresh install (no user_profile row), before
// onboarding, offer 'Restore from a backup' alongside 'Start fresh'. This
// is the moment restore matters most and the user will not think to go
// hunting in Settings for it."
//
// This is the ONLY place restore is offered before a profile exists —
// SettingsScreen's "Restore from file" (for later, e.g. switching phones
// after already re-onboarding, or recovering from a bad edit) reuses the
// same restoreFromSnapshot + confirmation copy, just reached from a
// different entry point once a profile already exists.
//
// Copy is neutral per PRD §10 ("no guilt language") — a fresh install
// with no backup available yet is a normal state, not a mistake to call
// out.
// ═══════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { File } from 'expo-file-system';
import type { RootStackParamList } from '../lib/navigation';
import { colors, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import { parseSnapshot } from '../lib/backup/snapshot';
import { restoreFromSnapshot } from '../lib/backup/restore';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RestoreOffer'>;

export function RestoreOfferScreen() {
  const navigation = useNavigation<Nav>();
  const [busy, setBusy] = useState(false);

  const startFresh = () => {
    navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      const result = await File.pickFileAsync({ mimeTypes: ['application/json'] });
      if (result.canceled) return;

      const text = await result.result.text();
      const snapshot = parseSnapshot(text);

      const dateRange =
        snapshot.weight_log.length > 0
          ? `weight readings from ${snapshot.weight_log[0].date} to ${snapshot.weight_log[snapshot.weight_log.length - 1].date}`
          : 'no weight readings';
      const foodCount = snapshot.food_entry.length;

      Alert.alert(
        'Restore this backup?',
        `This file contains ${dateRange} and ${foodCount} food ${foodCount === 1 ? 'entry' : 'entries'}, exported ${new Date(snapshot.exported_at).toLocaleString()}.\n\nThis replaces everything on this device with the backup's contents. There is nothing to undo afterwards.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Restore',
            onPress: () => void doRestore(snapshot),
          },
        ]
      );
    } catch (e) {
      Alert.alert('Could not read that file', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (snapshot: Parameters<typeof restoreFromSnapshot>[1]) => {
    setBusy(true);
    try {
      const db = await getDatabase();
      await restoreFromSnapshot(db, snapshot);
      // A profile now exists (restored), so Tabs renders normally —
      // there is nothing left for Onboarding to do.
      navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
    } catch (e) {
      Alert.alert('Restore failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Welcome</Text>
        <Text style={styles.subtitle}>
          If you've used this app before and have a backup file, you can restore your food log, weight
          history, and targets now. Otherwise, start fresh — you can always restore a backup later from
          Settings.
        </Text>

        <Pressable
          onPress={() => void handleRestore()}
          disabled={busy}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed, busy && styles.buttonDisabled]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{busy ? 'Working…' : 'Restore from a backup'}</Text>
        </Pressable>

        <Pressable
          onPress={startFresh}
          disabled={busy}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed, busy && styles.buttonDisabled]}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>Start fresh</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  header: {
    ...type.h1,
    color: colors.text,
    marginBottom: spacing.md,
  },
  subtitle: {
    ...type.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  primaryButtonText: {
    ...type.bodyStrong,
    color: colors.background,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    ...type.body,
    color: colors.text,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
