// ═══════════════════════════════════════════════════════════════════════
// SettingsScreen — PRD §12 export/import UI + profile edit entry point +
// automatic backup controls (backup/restore task brief §5).
//
// "Export: full JSON dump + per-table CSV, via share sheet. Available
// from day one. Import: generic CSV for weight_log and day_intake."
// "The point of this app is escaping a subscription. Don't build a new
// prison." — every button on this screen exists to make that literally
// true: no export requires a subscription tier, no network call, no
// paywall.
//
// The Backup section is deliberately honest rather than reassuring (task
// brief: "Be honest in the copy about what is and isn't protected") — no
// green checkmark implying "you're safe now," just the plain facts: is a
// folder chosen, when did a snapshot last succeed (or did it fail), and
// what restoring does. No red anywhere (PRD §10) — "never backed up" and
// a backup error both render in the same neutral text tone as everything
// else on this screen, not an alarm colour.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { File } from 'expo-file-system';
import type { RootStackParamList } from '../lib/navigation';
import { colors, numeric, radii, spacing, minTouchTarget, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import { exportJsonAndShare, exportAllCsvAndShare, importCsvText, type ImportTarget } from '../lib/exportActions';
import {
  getBackupSetupState,
  chooseBackupFolder,
  clearBackupFolder,
  getBackupDirectory,
  recordBackupSuccess,
  recordBackupFailure,
  type BackupSetupState,
} from '../lib/backup/backupLocation';
import { writeSnapshotAndPrune } from '../lib/backup/autoBackup';
import { parseSnapshot } from '../lib/backup/snapshot';
import { restoreFromSnapshot } from '../lib/backup/restore';
import {
  getReminderState,
  enableReminder,
  disableReminder,
  updateReminderTime,
  type ReminderState,
} from '../lib/notifications/reminderActions';
import { shiftTime, formatTime12h } from '../lib/notifications/weighInReminder';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

function formatFolderUri(uri: string): string {
  // content:// URIs are long and not very readable; show a short,
  // recognizable tail rather than the full opaque string.
  const decoded = decodeURIComponent(uri);
  const parts = decoded.split(/[/:]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : decoded;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const [busy, setBusy] = useState<string | null>(null);
  const [backupState, setBackupState] = useState<BackupSetupState | null>(null);
  const [reminderState, setReminderState] = useState<ReminderState | null>(null);

  const refreshBackupState = useCallback(() => {
    void (async () => {
      const db = await getDatabase();
      setBackupState(await getBackupSetupState(db));
    })();
  }, []);

  useFocusEffect(refreshBackupState);

  // Re-read on every focus (not just once) so returning from the system
  // notification-settings page (see "Open notification settings" below)
  // reflects a permission change the user just made there — a toggle
  // that keeps showing stale state after that round-trip would be
  // exactly the kind of lie CLAUDE.md's brief warns against.
  const refreshReminderState = useCallback(() => {
    void (async () => {
      const db = await getDatabase();
      setReminderState(await getReminderState(db));
    })();
  }, []);

  useFocusEffect(refreshReminderState);

  const handleToggleReminder = async (next: boolean) => {
    if (!reminderState) return;
    setBusy('reminder-toggle');
    try {
      const db = await getDatabase();
      if (next) {
        // The ONLY place this app prompts for notification permission —
        // direct response to the user turning this on, never at startup
        // (CLAUDE.md: "ask permission only when the user turns it on").
        const result = await enableReminder(db, reminderState.hour, reminderState.minute);
        if (result.permission !== 'granted') {
          Alert.alert(
            'Notifications are off',
            'Joule needs notification permission to send the morning reminder. You can turn it on in system settings.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open settings', onPress: () => void Linking.openSettings() },
            ]
          );
        }
      } else {
        await disableReminder(db);
      }
      setReminderState(await getReminderState(db));
    } finally {
      setBusy(null);
    }
  };

  const handleShiftReminderTime = async (deltaMinutes: number) => {
    if (!reminderState) return;
    setBusy('reminder-time');
    try {
      const db = await getDatabase();
      const { hour, minute } = shiftTime(reminderState.hour, reminderState.minute, deltaMinutes);
      await updateReminderTime(db, hour, minute);
      setReminderState(await getReminderState(db));
    } finally {
      setBusy(null);
    }
  };

  // Reflects the REAL effective state, not just the stored preference —
  // if permission was revoked in system settings after the reminder was
  // turned on, the switch must show off, not a comforting lie.
  const reminderEffectivelyOn = reminderState?.enabled === true && reminderState.permission === 'granted';
  const reminderNeedsPermission = reminderState?.enabled === true && reminderState.permission !== 'granted';

  const handleExportJson = async () => {
    setBusy('json');
    try {
      const db = await getDatabase();
      await exportJsonAndShare(db);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleExportCsv = async () => {
    setBusy('csv');
    try {
      const db = await getDatabase();
      await exportAllCsvAndShare(db);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async (target: ImportTarget) => {
    setBusy(`import-${target}`);
    try {
      const result = await File.pickFileAsync({ mimeTypes: ['text/csv', 'text/comma-separated-values', 'text/plain'] });
      if (result.canceled) return;

      const text = await result.result.text();
      const db = await getDatabase();
      const importResult = await importCsvText(db, target, text);

      if (importResult.errors.length > 0) {
        Alert.alert(
          'Imported with warnings',
          `${importResult.rowsImported} rows imported. ${importResult.errors.length} row(s) had issues:\n${importResult.errors.slice(0, 5).join('\n')}`
        );
      } else {
        Alert.alert('Import complete', `${importResult.rowsImported} rows imported into ${target}.`);
      }
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleChooseFolder = async () => {
    setBusy('choose-folder');
    try {
      const db = await getDatabase();
      const uri = await chooseBackupFolder(db);
      if (uri !== null) {
        setBackupState(await getBackupSetupState(db));
      }
    } catch (e) {
      Alert.alert('Could not set backup folder', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleForgetFolder = () => {
    Alert.alert('Stop backing up to this folder?', 'Automatic backups will stop until you choose a folder again. Existing backup files already written there are not deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop backing up',
        onPress: () =>
          void (async () => {
            const db = await getDatabase();
            await clearBackupFolder(db);
            setBackupState(await getBackupSetupState(db));
          })(),
      },
    ]);
  };

  const handleBackupNow = async () => {
    setBusy('backup-now');
    try {
      const db = await getDatabase();
      const dir = await getBackupDirectory(db);
      if (!dir) {
        Alert.alert('No backup folder chosen yet', 'Choose a folder first, then backups can run automatically and on demand.');
        return;
      }
      await writeSnapshotAndPrune(db, dir);
      await recordBackupSuccess(db, Date.now());
      setBackupState(await getBackupSetupState(db));
      Alert.alert('Backup complete', backupState?.requiresFolderSelection ? 'A new snapshot was written to your chosen folder.' : 'A new snapshot was written and is included in your iCloud/device backup.');
    } catch (e) {
      const db = await getDatabase();
      await recordBackupFailure(db, e instanceof Error ? e.message : String(e));
      setBackupState(await getBackupSetupState(db));
      Alert.alert('Backup failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRestoreFromFile = async () => {
    setBusy('restore');
    try {
      const result = await File.pickFileAsync({ mimeTypes: ['application/json'] });
      if (result.canceled) return;

      const text = await result.result.text();
      const snapshot = parseSnapshot(text);
      const foodCount = snapshot.food_entry.length;
      const weightCount = snapshot.weight_log.length;

      Alert.alert(
        'Restore this backup?',
        `This file has ${weightCount} weight ${weightCount === 1 ? 'reading' : 'readings'} and ${foodCount} food ${foodCount === 1 ? 'entry' : 'entries'}, exported ${new Date(snapshot.exported_at).toLocaleString()}.\n\nRestoring replaces everything currently on this device — food log, weights, saved foods, pots, and targets — with the contents of this file. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace everything',
            onPress: () =>
              void (async () => {
                setBusy('restore');
                try {
                  const db = await getDatabase();
                  await restoreFromSnapshot(db, snapshot);
                  Alert.alert('Restore complete', 'Your data has been replaced with the backup’s contents.');
                } catch (e) {
                  Alert.alert('Restore failed', e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(null);
                }
              })(),
          },
        ]
      );
    } catch (e) {
      Alert.alert('Could not read that file', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Settings</Text>

        <Section title="Profile">
          <ActionButton label="Edit profile / onboarding answers" onPress={() => navigation.navigate('Onboarding')} />
        </Section>

        <Section title="Supplements" subtitle="Vitamins, peptides — whatever you take. Track adherence separately from food; nothing here reaches your calorie log unless you explicitly log it as food too.">
          <ActionButton label="Manage supplements" onPress={() => navigation.navigate('Supplements')} />
        </Section>

        <Section
          title="Zepp / wearable data"
          subtitle="Reference only — shown on the Trends chart alongside Joule's own measured TDEE, never used to compute it or adjust targets (PRD §11)."
        >
          <ActionButton label="Import Zepp export" onPress={() => navigation.navigate('ZeppImport')} />
        </Section>

        <Section
          title="Weigh-in reminder"
          subtitle="A daily nudge to log this morning's number — skipped automatically once today's weight is in. Off by default."
        >
          <View style={styles.reminderRow}>
            <Text style={styles.reminderLabel}>Morning reminder</Text>
            <Switch
              value={reminderEffectivelyOn}
              onValueChange={(next) => void handleToggleReminder(next)}
              disabled={busy !== null || !reminderState}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={colors.text}
            />
          </View>

          {reminderState?.enabled && (
            <View style={styles.timeRow}>
              <Pressable
                onPress={() => void handleShiftReminderTime(-15)}
                disabled={busy !== null}
                style={({ pressed }) => [styles.timeButton, pressed && styles.actionButtonPressed]}
                accessibilityRole="button"
                accessibilityLabel="15 minutes earlier"
              >
                <Text style={styles.timeButtonText}>−15m</Text>
              </Pressable>
              <Text style={styles.timeValue}>{formatTime12h(reminderState.hour, reminderState.minute)}</Text>
              <Pressable
                onPress={() => void handleShiftReminderTime(15)}
                disabled={busy !== null}
                style={({ pressed }) => [styles.timeButton, pressed && styles.actionButtonPressed]}
                accessibilityRole="button"
                accessibilityLabel="15 minutes later"
              >
                <Text style={styles.timeButtonText}>+15m</Text>
              </Pressable>
            </View>
          )}

          {reminderNeedsPermission && (
            <>
              <Text style={styles.statusLine}>
                Notifications are turned off for Joule in system settings, so this reminder won&apos;t actually appear.
              </Text>
              <ActionButton label="Open notification settings" onPress={() => void Linking.openSettings()} disabled={busy !== null} />
            </>
          )}
        </Section>

        <Section
          title="Backup"
          subtitle={
            backupState?.requiresFolderSelection
              ? "An uninstall or a new phone wipes this app's storage completely. Choosing a folder here writes a snapshot there automatically (once a day, at most) so your food log, weight history, and targets survive that."
              : 'Backups are automatic — a snapshot is written to this app\'s own storage (once a day, at most), which iOS includes in your iCloud or device backup by default. No folder to choose, nothing to set up. If iCloud Backup (or Finder/iTunes backup) is turned off for this device, that automatic protection does not apply — use "Export / share a backup file" below to keep a copy yourself.'
          }
        >
          {backupState?.requiresFolderSelection ? (
            <Text style={styles.statusLine}>
              {backupState?.folderUri ? `Folder: ${formatFolderUri(backupState.folderUri)}` : 'No folder chosen yet — nothing is being backed up automatically.'}
            </Text>
          ) : (
            <Text style={styles.statusLine}>Storage: this app's documents (included in iCloud/device backup)</Text>
          )}
          <Text style={styles.statusLine}>
            {backupState?.lastBackupAt
              ? `Last backup: ${formatTimestamp(backupState.lastBackupAt)}`
              : 'Never backed up.'}
          </Text>
          {backupState?.lastBackupError && (
            <Text style={styles.statusLine}>Last attempt failed: {backupState.lastBackupError}</Text>
          )}

          {backupState?.requiresFolderSelection && (
            <ActionButton
              label={busy === 'choose-folder' ? 'Opening picker…' : backupState?.folderUri ? 'Change backup folder' : 'Choose backup folder'}
              onPress={() => void handleChooseFolder()}
              disabled={busy !== null}
            />
          )}
          {backupState?.requiresFolderSelection && backupState?.folderUri && (
            <ActionButton label="Stop backing up to this folder" onPress={handleForgetFolder} disabled={busy !== null} />
          )}
          <ActionButton label={busy === 'backup-now' ? 'Backing up…' : 'Back up now'} onPress={() => void handleBackupNow()} disabled={busy !== null} />
          <ActionButton
            label={busy === 'restore' ? 'Working…' : 'Restore from file'}
            onPress={() => void handleRestoreFromFile()}
            disabled={busy !== null}
          />
        </Section>

        <Section title="Export" subtitle="No subscription, no lock-in — your data, on your device, in a standard format. This is also the way to get a backup file off the device by hand at any time, on either platform.">
          <ActionButton label={busy === 'json' ? 'Exporting…' : 'Export / share a backup file'} onPress={() => void handleExportJson()} disabled={busy !== null} />
          <ActionButton label={busy === 'csv' ? 'Exporting…' : 'Export all tables as CSV'} onPress={() => void handleExportCsv()} disabled={busy !== null} />
        </Section>

        <Section title="Import" subtitle="Generic CSV import for weight and daily intake — restoring a backup or migrating from another app.">
          <ActionButton
            label={busy === 'import-weight_log' ? 'Importing…' : 'Import weight_log CSV'}
            onPress={() => void handleImport('weight_log')}
            disabled={busy !== null}
          />
          <ActionButton
            label={busy === 'import-day_intake' ? 'Importing…' : 'Import day_intake CSV'}
            onPress={() => void handleImport('day_intake')}
            disabled={busy !== null}
          />
        </Section>

        <Section
          title="Data health"
          subtitle="Scans your logged entries for arithmetic that doesn't add up — including a since-fixed unit-conversion bug that could have left some energy figures too low. Nothing is changed without your say-so."
        >
          <ActionButton label="Review data health" onPress={() => navigation.navigate('DataHealth')} />
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      {children}
    </View>
  );
}

function ActionButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed, disabled && styles.actionButtonDisabled]}
      accessibilityRole="button"
    >
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
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
  header: {
    ...type.h1,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  statusLine: {
    ...type.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  sectionSubtitle: {
    ...type.caption,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  actionButton: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionButtonPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    ...type.body,
    color: colors.text,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: minTouchTarget,
  },
  reminderLabel: {
    ...type.body,
    color: colors.text,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  timeButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  timeButtonText: {
    ...type.bodyStrong,
    color: colors.text,
  },
  timeValue: {
    ...type.h2,
    ...numeric,
    color: colors.text,
    minWidth: 96,
    textAlign: 'center',
  },
});
