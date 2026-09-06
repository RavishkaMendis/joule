// ═══════════════════════════════════════════════════════════════════════
// ZeppImportScreen — pick a Zepp export, preview, confirm, commit (task
// brief "Feature 2 — Zepp import").
//
// ⚠️ Every row this screen ever writes goes to `external_estimate` only,
// via src/lib/import/zeppImport.ts's commitZeppImport — reference-only
// data, never read by src/engine/** (PRD §3, §11; enforced structurally
// by eslint.config.js's engine wall, not by convention here). Nothing on
// this screen writes weight_log or day_intake directly. The ONE exception
// is the auto-confounder step at the very end, and even that only ever
// runs via weightRepo.setConfounder — the exact same call the confounder
// UI elsewhere in the app already uses — and ONLY on a suggestion the
// user has explicitly selected and confirmed. Nothing here is silent:
// picking a file never writes anything until "Confirm import" is tapped,
// and a confounder is never flagged until the user ticks it and taps
// "Apply".
// ═══════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import { colors, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import {
  parseZeppFile,
  planZeppImport,
  commitZeppImport,
  type ZeppFileParseResult,
  type ZeppImportPlan,
  type ZeppImportResult,
} from '../lib/import/zeppImport';
import { ZEPP_TARGET_FIELDS, type ColumnMapping, type ZeppTargetField } from '../lib/import/zeppMapping';
import { suggestConfounders, type ConfounderSuggestion } from '../lib/import/autoConfounder';
import * as externalEstimateRepo from '../db/repositories/externalEstimateRepo';
import * as weightRepo from '../db/repositories/weightRepo';

type Step = 'pick' | 'mapping' | 'preview' | 'result';

const FIELD_LABELS: Record<ZeppTargetField, string> = {
  date: 'Date (required)',
  tdee_est: 'Estimated TDEE',
  active_kcal: 'Active calories',
  steps: 'Steps',
  sleep_minutes: 'Sleep (minutes)',
  readiness: 'Readiness / recovery',
};

const SKIP_REASON_DISPLAY_CAP = 8;

export function ZeppImportScreen() {
  const [step, setStep] = useState<Step>('pick');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [parsed, setParsed] = useState<ZeppFileParseResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [openField, setOpenField] = useState<ZeppTargetField | null>(null);
  const [plan, setPlan] = useState<ZeppImportPlan | null>(null);
  const [result, setResult] = useState<ZeppImportResult | null>(null);
  const [suggestions, setSuggestions] = useState<ConfounderSuggestion[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState(false);

  const reset = () => {
    setStep('pick');
    setError(null);
    setParsed(null);
    setMapping({});
    setOpenField(null);
    setPlan(null);
    setResult(null);
    setSuggestions([]);
    setSelectedSuggestions(new Set());
    setApplied(false);
  };

  const handlePickFile = async () => {
    setBusy(true);
    setError(null);
    try {
      const picked = await File.pickFileAsync({
        mimeTypes: ['text/csv', 'text/comma-separated-values', 'application/json', 'text/plain'],
      });
      if (picked.canceled) return;

      const text = await picked.result.text();
      const parsedFile = parseZeppFile(text);
      if (parsedFile.unsupportedFormatError) {
        setError(parsedFile.unsupportedFormatError);
        return;
      }
      if (parsedFile.rawRows.length === 0) {
        setError('This file has no rows to import.');
        return;
      }
      setParsed(parsedFile);
      setMapping(parsedFile.suggestedMapping);
      setStep('mapping');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSelectHeader = (field: ZeppTargetField, header: string | undefined) => {
    setMapping((prev) => ({ ...prev, [field]: header }));
    setOpenField(null);
  };

  const handleBuildPreview = async () => {
    if (!parsed) return;
    if (!mapping.date) {
      setError('Map a column to "Date" before continuing — every row needs one.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const db = await getDatabase();
      const builtPlan = await planZeppImport(db, parsed.rawRows, mapping);
      setPlan(builtPlan);
      setStep('preview');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const db = await getDatabase();
      const importResult = await commitZeppImport(db, parsed.rawRows, mapping);
      setResult(importResult);

      // Auto-confounder suggestions (PRD §11) — computed AFTER commit, over
      // exactly the range just imported, and never applied automatically.
      if (plan?.dateRangeStart && plan.dateRangeEnd) {
        const [estimates, weights] = await Promise.all([
          externalEstimateRepo.getRange(db, plan.dateRangeStart, plan.dateRangeEnd),
          weightRepo.getRange(db, plan.dateRangeStart, plan.dateRangeEnd),
        ]);
        setSuggestions(suggestConfounders(estimates, weights));
      }
      setStep('result');
    } finally {
      setBusy(false);
    }
  };

  const toggleSuggestion = (date: string) => {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const handleApplySuggestions = () => {
    const toApply = suggestions.filter((s) => selectedSuggestions.has(s.date));
    if (toApply.length === 0) return;
    Alert.alert(
      'Flag poor sleep on these mornings?',
      `This sets the "poor sleep" confounder on ${toApply.length} weight ${toApply.length === 1 ? 'reading' : 'readings'}, which tells the TDEE engine to trust ${toApply.length === 1 ? 'that reading' : 'those readings'} less rather than ignore ${toApply.length === 1 ? 'it' : 'them'}. You can undo this per-day from weight entry at any time.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          onPress: () =>
            void (async () => {
              setBusy(true);
              try {
                const db = await getDatabase();
                for (const s of toApply) {
                  await weightRepo.setConfounder(db, s.date, s.suggested);
                }
                setApplied(true);
              } finally {
                setBusy(false);
              }
            })(),
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.header}>Import Zepp data</Text>
      <Text style={styles.subtitle}>
        Reference only — this data shows on the Trends chart alongside Joule&apos;s own measured TDEE. It is never
        used to compute TDEE or adjust targets.
      </Text>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {step === 'pick' && (
        <View style={styles.section}>
          <Text style={styles.sectionText}>
            Export your data from the Zepp app (CSV or JSON) and choose the file here. Nothing is imported until you
            confirm on the preview screen.
          </Text>
          <ActionButton label={busy ? 'Opening picker…' : 'Choose file'} onPress={() => void handlePickFile()} disabled={busy} />
        </View>
      )}

      {step === 'mapping' && parsed && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Match columns ({parsed.format.toUpperCase()}, {parsed.rawRows.length} rows)
          </Text>
          <Text style={styles.sectionText}>
            Joule guessed which column is which — check each one before continuing, especially Date.
          </Text>
          {ZEPP_TARGET_FIELDS.map((field) => (
            <View key={field} style={styles.mappingRow}>
              <Text style={styles.mappingLabel}>{FIELD_LABELS[field]}</Text>
              <Pressable
                style={styles.mappingValue}
                onPress={() => setOpenField(openField === field ? null : field)}
                accessibilityRole="button"
              >
                <Text style={styles.mappingValueText}>{mapping[field] ?? 'Not mapped'}</Text>
              </Pressable>
              {openField === field && (
                <View style={styles.headerList}>
                  <Pressable style={styles.headerOption} onPress={() => handleSelectHeader(field, undefined)}>
                    <Text style={styles.headerOptionText}>Not mapped</Text>
                  </Pressable>
                  {parsed.headers.map((h) => (
                    <Pressable key={h} style={styles.headerOption} onPress={() => handleSelectHeader(field, h)}>
                      <Text style={styles.headerOptionText}>{h}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          ))}
          <ActionButton label={busy ? 'Working…' : 'Preview import'} onPress={() => void handleBuildPreview()} disabled={busy} />
          <ActionButton label="Choose a different file" onPress={reset} disabled={busy} />
        </View>
      )}

      {step === 'preview' && plan && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preview</Text>
          <Text style={styles.sectionText}>
            {plan.totalParseable} of {plan.totalRows} rows will import
            {plan.totalSkipped > 0 ? ` (${plan.totalSkipped} skipped)` : ''}.
          </Text>
          {plan.dateRangeStart && plan.dateRangeEnd && (
            <Text style={styles.sectionText}>
              Date range: {plan.dateRangeStart} to {plan.dateRangeEnd}
            </Text>
          )}
          {plan.conflictDates.length > 0 && (
            <Text style={styles.sectionText}>
              {plan.conflictDates.length} {plan.conflictDates.length === 1 ? 'day' : 'days'} already has imported
              data and will be overwritten with this file&apos;s values.
            </Text>
          )}
          {plan.ambiguityNotes.length > 0 && (
            <View style={styles.noteBox}>
              {plan.ambiguityNotes.map((note) => (
                <Text key={note} style={styles.noteText}>
                  {note}
                </Text>
              ))}
            </View>
          )}
          {plan.skipReasons.length > 0 && (
            <View style={styles.noteBox}>
              <Text style={styles.sectionText}>Skipped rows:</Text>
              {plan.skipReasons.slice(0, SKIP_REASON_DISPLAY_CAP).map((reason, i) => (
                <Text key={i} style={styles.noteText}>
                  {reason}
                </Text>
              ))}
              {plan.skipReasons.length > SKIP_REASON_DISPLAY_CAP && (
                <Text style={styles.noteText}>…and {plan.skipReasons.length - SKIP_REASON_DISPLAY_CAP} more.</Text>
              )}
            </View>
          )}
          {plan.sampleRows.length > 0 && (
            <View style={styles.noteBox}>
              <Text style={styles.sectionText}>Sample rows:</Text>
              {plan.sampleRows.map((row) => (
                <Text key={row.date} style={styles.noteText}>
                  {row.date} — steps {row.steps ?? '—'}, sleep {row.sleep_minutes ?? '—'}m, TDEE {row.tdee_est ?? '—'}
                </Text>
              ))}
            </View>
          )}
          <ActionButton
            label={busy ? 'Importing…' : 'Confirm import'}
            onPress={() => void handleConfirmImport()}
            disabled={busy || plan.totalParseable === 0}
          />
          <ActionButton label="Back to column mapping" onPress={() => setStep('mapping')} disabled={busy} />
        </View>
      )}

      {step === 'result' && result && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Import complete</Text>
          <Text style={styles.sectionText}>
            {result.rowsImported} {result.rowsImported === 1 ? 'row' : 'rows'} imported
            {result.rowsSkipped > 0 ? `, ${result.rowsSkipped} skipped` : ''}.
          </Text>

          {suggestions.length > 0 && !applied && (
            <View style={styles.noteBox}>
              <Text style={styles.sectionText}>
                {suggestions.length} morning{suggestions.length === 1 ? '' : 's'} in this import had short sleep
                logged with no confounder flagged on that weight reading. Select any you&apos;d like to flag as
                &quot;poor sleep&quot; — this tells the TDEE engine to trust that reading less, not ignore it. Nothing
                is applied unless you tap Apply below.
              </Text>
              {suggestions.map((s) => {
                const selected = selectedSuggestions.has(s.date);
                return (
                  <Pressable
                    key={s.date}
                    onPress={() => toggleSuggestion(s.date)}
                    style={[styles.suggestionRow, selected && styles.suggestionRowSelected]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                  >
                    <View style={[styles.checkbox, selected && styles.checkboxChecked]} />
                    <View style={styles.suggestionText}>
                      <Text style={styles.mappingLabel}>{s.date}</Text>
                      <Text style={styles.noteText}>{s.reason}</Text>
                    </View>
                  </Pressable>
                );
              })}
              <ActionButton
                label={
                  busy
                    ? 'Applying…'
                    : selectedSuggestions.size > 0
                      ? `Apply ${selectedSuggestions.size} selected`
                      : 'Select items to apply'
                }
                onPress={handleApplySuggestions}
                disabled={busy || selectedSuggestions.size === 0}
              />
            </View>
          )}
          {applied && <Text style={styles.sectionText}>Confounders applied. You can change or clear them from weight entry at any time.</Text>}

          <ActionButton label="Import another file" onPress={reset} disabled={busy} />
        </View>
      )}

      {busy && <ActivityIndicator color={colors.accent} style={styles.spinner} />}
    </ScrollView>
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
    paddingBottom: spacing.xxl,
  },
  header: {
    ...type.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...type.caption,
    color: colors.textTertiary,
    marginBottom: spacing.lg,
  },
  errorText: {
    ...type.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  sectionText: {
    ...type.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  mappingRow: {
    marginBottom: spacing.sm,
  },
  mappingLabel: {
    ...type.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  mappingValue: {
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  mappingValueText: {
    ...type.body,
    color: colors.text,
  },
  headerList: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.sm,
    marginTop: spacing.xs,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headerOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerOptionText: {
    ...type.caption,
    color: colors.text,
  },
  noteBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  noteText: {
    ...type.small,
    color: colors.textTertiary,
    marginBottom: 2,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  suggestionRowSelected: {
    opacity: 1,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  suggestionText: {
    flex: 1,
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
  spinner: {
    marginTop: spacing.md,
  },
});
