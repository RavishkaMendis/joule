// ═══════════════════════════════════════════════════════════════════════
// VoiceLogScreen — PRD §7.1, the primary input.
//
// Hold-to-record -> release -> ONE shared ConfirmSheet. Per PRD §7.1 and
// CLAUDE.md's domain traps, this deliberately SKIPS speech-to-text: the
// recorded audio file is base64-encoded and sent straight to Gemini
// (Flash-Lite) with a structured-output prompt in one call. No
// @react-native-voice/voice, no transcription step, no expo-speech (that
// module is text-to-speech, the wrong direction entirely).
//
// "One wrap, about 150 grams of chicken, tablespoon of oil, bit of
// yoghurt" -> four PendingEntry rows on the sheet, per PRD §7.1's example.
//
// Uses expo-audio (installed) via useAudioRecorder/RecordingPresets.
// Missing API key degrades gracefully: the record button is replaced
// with a plain message and a link to manual entry — never a crash, and
// no microphone permission is even requested in that case.
//
// Date threading (task fix): reads `route.params.date` — the date
// TodayScreen was showing when this route was opened — instead of always
// calling `todayLocalISO()`. Dictating yesterday's dinner from memory is
// a legitimate backfill, not a live-capture-only action. A "Logging to
// <date>" banner surfaces a non-today date plainly rather than silently
// changing which day this logs against.
//
// ─── Background analysis ─────────────────────────────────────────────
// Same src/lib/captureJobs wiring as MealPhotoScreen/LabelScanScreen (see
// MealPhotoScreen's header for the full mechanism/rationale) —
// `stopAndProcess` submits a job and returns immediately; `processing`
// now carries the job's id so this screen can watch it via
// `useCaptureJob` and apply its outcome the moment it settles, exactly
// as the old inline `await runVoiceParse(...)` used to.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, radii, spacing, type } from '../lib/theme';
import { resolveCaptureDate } from '../lib/dateNav';
import { getDatabase } from '../lib/db';
import { ConfirmSheet } from '../components/ConfirmSheet';
import type { PendingEntry } from '../lib/pendingEntry';
import { hasGeminiApiKey, MISSING_KEY_MESSAGE } from '../lib/ai/apiKey';
import { dismissJob, submitJob, useCaptureJob, useWatchCaptureJob, type CaptureJobInput } from '../lib/captureJobs';
import { CaptureDateBanner } from '../components/capture/CaptureDateBanner';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'VoiceLog'>;

type ScreenState =
  | { phase: 'idle' }
  | { phase: 'recording' }
  | { phase: 'processing' }
  | { phase: 'confirming'; entries: PendingEntry[] }
  | { phase: 'error'; message: string };

/**
 * expo-audio's HIGH_QUALITY preset records .m4a (AAC) on both iOS and
 * Android — this MIME type is what accompanies the base64 audio in the
 * Gemini request.
 */
const AUDIO_MIME_TYPE = 'audio/m4a';

export function VoiceLogScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const date = resolveCaptureDate(route.params?.date);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [state, setState] = useState<ScreenState>({ phase: 'idle' });
  const [permissionDenied, setPermissionDenied] = useState(false);
  // Independent of `state.phase` deliberately — it must survive the
  // 'processing' -> 'confirming'/'error' transition (unlike the jobId
  // `state` itself briefly carries) so `finishActiveJob` can still find
  // and dismiss the job once the ConfirmSheet confirms/cancels or the
  // user retries. Bug this fixes: an earlier version derived this from
  // `state.phase === 'processing' ? state.jobId : null`, which went null
  // the instant the job settled — `finishActiveJob` would then silently
  // no-op on confirm, leaving a `done` job stuck in the store forever
  // (a stale, still-tappable "ready to confirm" pill on Today for
  // something already logged — a real double-log risk).
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const activeJob = useCaptureJob(activeJobId);
  useWatchCaptureJob(activeJobId);

  useEffect(() => {
    // Recording requires the global audio mode to allow it — set once on mount.
    setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {
      /* best-effort; permission/record errors are surfaced when the user actually tries to record */
    });
  }, []);

  // Applies a watched job's eventual outcome — same mechanism as
  // MealPhotoScreen/LabelScanScreen's identical effect.
  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === 'done') {
      setState({ phase: 'confirming', entries: activeJob.entries ?? [] });
    } else if (activeJob.status === 'error') {
      setState({ phase: 'error', message: activeJob.errorMessage ?? 'Something went wrong.' });
    }
  }, [activeJob]);

  const goToManualEntry = useCallback(() => {
    navigation.navigate('FoodEntry', { date });
  }, [navigation, date]);

  // Drops whatever job this screen submitted — "Try again"/"Enter
  // manually instead" from the error state, and confirming/cancelling
  // the sheet, all mean the job is done being useful to this screen.
  const finishActiveJob = useCallback(async () => {
    if (!activeJobId) return;
    const db = await getDatabase();
    dismissJob(db, activeJobId);
    setActiveJobId(null);
  }, [activeJobId]);

  const resetToIdle = useCallback(() => {
    void finishActiveJob();
    setState({ phase: 'idle' });
  }, [finishActiveJob]);

  const startRecording = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);
    await recorder.prepareToRecordAsync();
    recorder.record();
    setState({ phase: 'recording' });
  }, [recorder]);

  const stopAndProcess = useCallback(async () => {
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) {
      setState({ phase: 'error', message: 'No recording was captured. Try holding the button a little longer.' });
      return;
    }

    // Submits the recording as a background job (src/lib/captureJobs) and
    // returns immediately — see this file's header. The runner reads the
    // file's bytes lazily (this screen never had them in memory either
    // way; expo-audio only ever exposes a file uri).
    const db = await getDatabase();
    const input: CaptureJobInput = { kind: 'voice', audioUri: uri, mimeType: AUDIO_MIME_TYPE };
    const job = submitJob(db, date, input);
    setActiveJobId(job.id);
    setState({ phase: 'processing' });
  }, [recorder, date]);

  const leaveInBackground = useCallback(() => {
    // Job keeps running — see MealPhotoScreen's identical action for why.
    navigation.goBack();
  }, [navigation]);

  if (!hasGeminiApiKey()) {
    return (
      <View style={styles.screen}>
        <View style={styles.centeredContent}>
          <Text style={styles.title}>Voice log unavailable</Text>
          <Text style={styles.subtitle}>{MISSING_KEY_MESSAGE}</Text>
          <Pressable onPress={goToManualEntry} style={styles.primaryButton} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Enter manually instead</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state.phase === 'confirming') {
    return (
      <ConfirmSheet
        entries={state.entries}
        date={date}
        onConfirm={async () => {
          await finishActiveJob();
          navigation.goBack();
        }}
        onCancel={resetToIdle}
        fallbackAction={undefined}
      />
    );
  }

  if (state.phase === 'error') {
    return (
      <View style={styles.screen}>
        <View style={styles.centeredContent}>
          <Text style={styles.title}>Couldn't parse that</Text>
          <Text style={styles.subtitle}>{state.message}</Text>
          <Pressable onPress={resetToIdle} style={styles.primaryButton} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void finishActiveJob();
              goToManualEntry();
            }}
            style={styles.secondaryButton}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Enter manually instead</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.centeredContent}>
        <CaptureDateBanner date={date} />
        <Text style={styles.title}>Voice log</Text>
        <Text style={styles.subtitle}>
          Hold the button and describe what you ate — e.g. "one wrap, about 150 grams of chicken, tablespoon of
          oil, bit of yoghurt".
        </Text>

        {permissionDenied && (
          <Text style={styles.permissionWarning}>
            Microphone permission was denied. Enable it in system settings to use voice logging.
          </Text>
        )}

        {state.phase === 'processing' ? (
          <View style={styles.processingRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.subtitle}>Listening to that…</Text>
            {/* Task brief: "let the user leave immediately" — the job
                (src/lib/captureJobs) keeps running; leaving here just
                stops watching it, so the result surfaces later via
                notification + the Today pill instead. */}
            <Pressable onPress={leaveInBackground} style={styles.secondaryButton} accessibilityRole="button">
              <Text style={styles.secondaryButtonText}>Leave — I&apos;ll get notified</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPressIn={() => void startRecording()}
            onPressOut={() => void stopAndProcess()}
            style={[styles.recordButton, recorderState.isRecording && styles.recordButtonActive]}
            accessibilityRole="button"
            accessibilityLabel="Hold to record a voice note"
          >
            <Text style={styles.recordButtonText}>{recorderState.isRecording ? 'Recording…' : 'Hold to record'}</Text>
          </Pressable>
        )}

        <Pressable onPress={goToManualEntry} style={styles.secondaryButton} accessibilityRole="button">
          <Text style={styles.secondaryButtonText}>Enter manually instead</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centeredContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    ...type.h2,
    color: colors.text,
  },
  subtitle: {
    ...type.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  permissionWarning: {
    ...type.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  recordButton: {
    width: 160,
    height: 160,
    borderRadius: radii.pill,
    borderWidth: 3,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  recordButtonActive: {
    backgroundColor: colors.accent,
  },
  recordButtonText: {
    ...type.bodyStrong,
    color: colors.text,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  primaryButtonText: {
    ...type.bodyStrong,
    color: colors.background,
  },
  secondaryButton: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  secondaryButtonText: {
    ...type.body,
    color: colors.textSecondary,
  },
});
