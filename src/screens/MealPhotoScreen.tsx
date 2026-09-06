// ═══════════════════════════════════════════════════════════════════════
// MealPhotoScreen — PRD §7.4, meal photo + optional annotation.
//
// Phase order (see src/components/capture/capturePhases.ts for the pure
// state machine): camera -> review -> processing -> confirming, with
// `error` reachable from `processing`. This replaced an earlier
// "annotate-before-capture" layout after real device use surfaced two
// problems:
//
//   1. The "what is it?" text field used to sit on the camera screen
//      BEFORE capture. Users shoot/pick the photo first and only then
//      know what's worth describing — doubly true for gallery picks,
//      where a pre-capture field made no sense at all. Now: capture (or
//      pick) lands on `review`, where the photo is shown, the text field
//      is pre-focused, and the existing hold-to-record voice note option
//      and a single "Analyse" action live together.
//   2. A gallery pick used to leave the user stuck on the camera screen
//      showing a static "reading food" message — no way back, no cancel.
//      `processing` now shows the captured photo dimmed behind a genuine
//      (if honest-not-literal) progress indicator via ProcessingOverlay,
//      and its Cancel action — plus the Android hardware back button,
//      wired via useCaptureBackHandler — always returns to `review` with
//      the photo and typed note fully intact (never a blank camera).
//
// The voice note (if any) is sent to Gemini alongside the photo in the
// SAME multimodal call so the model can align its own component
// identification with what was said (prompts.ts instructs it to prefer
// stated quantities — PRD §7.4's "the user's stated quantities win").
//
// Where the user gives no quantity for a component, PRD §7.4 says the
// model estimates and marks confidence 'low' — this screen never
// upgrades that confidence itself; it is surfaced honestly by the
// ConfirmSheet via the existing confidence ladder (PRD §10).
//
// Missing API key degrades gracefully, same pattern as the other two
// AI screens: no camera/mic permission prompts fire, just a message and
// a link to manual entry.
//
// `runMealPhoto`'s signature and prompts.ts are untouched by this pass —
// only the screen-side wiring of when textNote/voiceNote are gathered
// and sent has changed.
//
// Date threading (task fix): reads `route.params.date` — the date
// TodayScreen was showing when this route was opened — instead of always
// calling `todayLocalISO()`. Photographing a plate eaten yesterday and
// annotating it this morning is a legitimate backfill, not a
// live-capture-only action. `CaptureDateBanner` surfaces a non-today date
// on the camera/review phases rather than silently changing which day
// this logs against.
//
// ─── Background analysis (task brief: "the scan can take a minute and
// I'm stuck waiting") ─────────────────────────────────────────────────
// The actual Gemini call no longer lives in this screen's own async
// function — `runAnalysis` now submits a job to src/lib/captureJobs and
// returns immediately, and a background job outlives this component
// entirely. `capturePhases.ts` itself is UNCHANGED (still owns exactly
// the draft/phase shape it always did — its own tests are untouched) —
// `activeJobId` is separate screen-local state that tracks which
// submitted job this screen is currently watching via `useCaptureJob`. A
// `useEffect` below applies the job's eventual `done`/`error` outcome to
// the existing phase machine exactly the way the old inline `await`
// used to, which is what keeps a fast scan (the common case) feeling
// exactly as synchronous as before: nothing here artificially waits or
// polls, the ConfirmSheet just appears the moment the job settles while
// this screen is still around to see it. If the user leaves first (the
// new "Leave — I'll get notified" action on ProcessingOverlay, or simply
// backgrounding/closing the app), `useWatchCaptureJob`'s cleanup stops
// suppressing the job's completion, and it surfaces later via a local
// notification plus the Today indicator pill instead — see
// src/lib/captureJobs/store.ts's header for why this needed no timeout
// heuristic to decide which path a given capture takes.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraCapturedPicture } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import * as potRepo from '../db/repositories/potRepo';
import { dismissPotNudge, hasPotNudgeBeenDismissed } from '../lib/potActions';
import {
  cancelProcessing,
  resetAfterConfirm,
  retryFromError,
  toCamera,
  toConfirming,
  toError,
  toProcessing,
  toReview,
  updateHasVoiceNote,
  updateTextNote,
  INITIAL_CAPTURE_PHASE,
  type CapturePhase,
  type ReviewDraft,
} from '../components/capture/capturePhases';
import { CaptureControlBar } from '../components/capture/CaptureControlBar';
import { CaptureHint } from '../components/capture/CaptureHint';
import { CaptureStatusScreen } from '../components/capture/CaptureStatusScreen';
import { ProcessingOverlay } from '../components/capture/ProcessingOverlay';
import { ReviewPanel } from '../components/capture/ReviewPanel';
import { useCaptureBackHandler } from '../components/capture/useCaptureBackHandler';
import { CaptureDateBanner } from '../components/capture/CaptureDateBanner';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'MealPhoto'>;

const AUDIO_MIME_TYPE = 'audio/m4a';

export function MealPhotoScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const date = resolveCaptureDate(route.params?.date);
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [phase, setPhase] = useState<CapturePhase>(INITIAL_CAPTURE_PHASE);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  // AI result for the confirm phase — not part of the phase machine's
  // draft (that's user-entered state; this is the model's output), set
  // at the same moment the phase flips to 'confirming'.
  const [confirmEntries, setConfirmEntries] = useState<PendingEntry[]>([]);
  // Which background job (src/lib/captureJobs) this screen is currently
  // watching, if any. Separate from `phase`/`ReviewDraft` deliberately —
  // the phase machine stays exactly as it was (still fully covered by
  // capturePhases.test.ts); this is purely screen-local bookkeeping for
  // "which job do I apply once it settles".
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const activeJob = useCaptureJob(activeJobId);
  // Suppresses the background notification while this screen is mounted
  // and tracking the job — see useCaptureJob.ts / store.ts's "fast path"
  // docs for exactly what this changes.
  useWatchCaptureJob(activeJobId);

  // Meal-photo -> pot nudge (task brief): when an active pot exists, offer
  // "log from your pot instead — it's more accurate" ONCE (persisted via
  // potActions.hasPotNudgeBeenDismissed/dismissPotNudge — the same
  // additive-table pattern src/lib/notifications/settingsStore.ts uses),
  // non-modally (a dismissable banner on the camera phase only, not a
  // popup blocking the shutter), dismissible. Checked only while on the
  // `camera` phase — the decision this nudge is trying to influence
  // ("should I even take this photo, or log from my pot instead?") is
  // only live at that moment; it would be noise on review/processing.
  const [showPotNudge, setShowPotNudge] = useState(false);
  useEffect(() => {
    if (phase.phase !== 'camera') return;
    let cancelled = false;
    (async () => {
      const db = await getDatabase();
      const [dismissed, activePots] = await Promise.all([hasPotNudgeBeenDismissed(db), potRepo.getActivePots(db)]);
      if (!cancelled) setShowPotNudge(!dismissed && activePots.length > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [phase.phase]);

  const dismissPotNudgeBanner = useCallback(() => {
    setShowPotNudge(false);
    void getDatabase().then((db) => dismissPotNudge(db));
  }, []);

  const goToPotFromNudge = useCallback(() => {
    dismissPotNudgeBanner();
    navigation.navigate('PotQuickAccess');
  }, [dismissPotNudgeBanner, navigation]);

  // Abandons whatever job this screen is currently tracking — the shared
  // meaning behind "Cancel", the hardware back button during processing,
  // discarding the ConfirmSheet, and re-submitting after an inline error
  // (see each call site below for why each of those counts as
  // "abandon"). Deliberately NOT what "Leave — I'll get notified" does —
  // that leaves the job running; see ProcessingOverlay's file header.
  const finishActiveJob = useCallback(async () => {
    if (!activeJobId) return;
    const db = await getDatabase();
    dismissJob(db, activeJobId);
    setActiveJobId(null);
  }, [activeJobId]);

  useCaptureBackHandler(phase, setPhase, finishActiveJob);

  useEffect(() => {
    setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {
      /* best-effort; surfaced when the user actually tries to record */
    });
  }, []);

  // Applies a watched job's eventual outcome to the existing phase
  // machine — the exact same `toConfirming`/`toError` calls the old
  // inline `await runMealPhoto(...)` used to make directly. This is what
  // makes the fast path feel unchanged: when the job settles while this
  // effect is still subscribed, the transition happens immediately, no
  // different from the previous synchronous flow.
  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === 'done') {
      setConfirmEntries(activeJob.entries ?? []);
      setPhase((prev) => toConfirming(prev));
    } else if (activeJob.status === 'error') {
      setPhase((prev) => toError(prev, activeJob.errorMessage ?? 'Something went wrong.'));
    }
  }, [activeJob]);

  const goToManualEntry = useCallback(() => {
    navigation.navigate('FoodEntry', { date });
  }, [navigation, date]);

  const startVoiceNote = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setMicPermissionDenied(true);
      return;
    }
    setMicPermissionDenied(false);
    await recorder.prepareToRecordAsync();
    recorder.record();
  }, [recorder]);

  const stopVoiceNote = useCallback(async () => {
    await recorder.stop();
    setPhase((prev) => updateHasVoiceNote(prev, recorder.uri !== null));
  }, [recorder]);

  const cancelAnalysis = useCallback(() => {
    void finishActiveJob();
    setPhase((prev) => cancelProcessing(prev));
  }, [finishActiveJob]);

  const leaveAnalysisInBackground = useCallback(() => {
    // Deliberately does NOT touch activeJobId/dismissJob — the job keeps
    // running; unmounting this screen just stops watching it, so its
    // eventual result surfaces via notification + the Today pill instead.
    navigation.goBack();
  }, [navigation]);

  const resetToCamera = useCallback(() => {
    void finishActiveJob();
    setPhase(resetAfterConfirm());
  }, [finishActiveJob]);
  const retakePhoto = useCallback(() => setPhase(toCamera()), []);
  const retryAfterError = useCallback(() => {
    // "Try again" re-shows `review` for a fresh Analyse tap (unchanged
    // behaviour) — the job that just errored has already been shown to
    // the user inline, so it's done being useful; drop it rather than
    // leaving it to also show up as a stale "failed" pill on Today.
    void finishActiveJob();
    setPhase((prev) => retryFromError(prev));
  }, [finishActiveJob]);

  // Submits the review draft as a background job (src/lib/captureJobs)
  // and returns immediately — the actual Gemini call happens outside
  // this screen's lifecycle from here on. Called only from the 'review'
  // phase (see the Analyse button below), so it takes the draft directly
  // rather than re-reading it back out of state.
  const submitAnalysis = useCallback(
    async (draft: ReviewDraft) => {
      setPhase((prev) => toProcessing(prev));
      const db = await getDatabase();

      // Photo and voice note (if any) go to Gemini in the SAME
      // multimodal call — no speech-to-text step (PRD §7.1). The runner
      // (src/lib/captureJobs/runner.ts) attaches the raw audio as a
      // second inline media part and the prompt instructs the model to
      // prefer whatever quantity it hears over its own visual estimate
      // (PRD §7.4). Only the file `uri` is submitted here, not a
      // pre-read base64 — the runner reads it lazily (and tolerates a
      // missing/unreadable voice note by proceeding photo-only), which
      // is also what lets a retry after this process restarted work at
      // all (see runner.ts).
      const input: CaptureJobInput = {
        kind: 'meal_photo',
        photoUri: draft.photo.uri,
        photoBase64: draft.photo.base64,
        textNote: draft.textNote.trim() || undefined,
        voiceNoteUri: recorder.uri ?? undefined,
        voiceNoteMimeType: recorder.uri ? AUDIO_MIME_TYPE : undefined,
      };
      const job = submitJob(db, date, input);
      setActiveJobId(job.id);
    },
    [date, recorder]
  );

  const capturePhotoAndReview = useCallback(async () => {
    if (!cameraRef) return;
    try {
      const photo: CameraCapturedPicture = await cameraRef.takePictureAsync({ base64: true, quality: 0.7 });
      if (!photo.base64) return;
      setPhase(toReview({ uri: photo.uri, base64: photo.base64 }));
    } catch {
      // Camera capture failed silently — stay on the camera phase so the
      // user can just try the shutter again rather than being bounced to
      // an error screen for a transient capture glitch.
    }
  }, [cameraRef]);

  const pickFromGalleryAndReview = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (!asset.base64) return;
    setPhase(toReview({ uri: asset.uri, base64: asset.base64 }));
  }, []);

  if (!hasGeminiApiKey()) {
    return (
      <CaptureStatusScreen
        title="Meal photo unavailable"
        message={MISSING_KEY_MESSAGE}
        actions={[{ label: 'Enter manually instead', onPress: goToManualEntry }]}
      />
    );
  }

  if (phase.phase === 'confirming') {
    return (
      <ConfirmSheet
        entries={confirmEntries}
        date={date}
        onConfirm={async () => {
          // The job has done everything it's going to do — its entries
          // are saved by ConfirmSheet itself; drop it so it doesn't also
          // linger as a stale "ready to confirm" pill on Today.
          await finishActiveJob();
          navigation.goBack();
        }}
        onCancel={resetToCamera}
        fallbackAction={undefined}
      />
    );
  }

  if (phase.phase === 'error') {
    return (
      <CaptureStatusScreen
        title="Couldn't read that photo"
        message={phase.message}
        actions={[
          { label: 'Try again', onPress: retryAfterError },
          {
            label: 'Enter manually instead',
            onPress: () => {
              void finishActiveJob();
              goToManualEntry();
            },
            variant: 'secondary',
          },
        ]}
      />
    );
  }

  if (phase.phase === 'processing') {
    return <ProcessingOverlay photo={phase.draft.photo} onCancel={cancelAnalysis} onLeaveInBackground={leaveAnalysisInBackground} />;
  }

  if (phase.phase === 'review') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <CaptureDateBanner date={date} />
        <ReviewPanel
          photo={phase.draft.photo}
          textNote={phase.draft.textNote}
          onChangeTextNote={(v) => setPhase((prev) => updateTextNote(prev, v))}
          isRecordingVoiceNote={recorderState.isRecording}
          hasVoiceNote={phase.draft.hasVoiceNote}
          onStartVoiceNote={() => void startVoiceNote()}
          onStopVoiceNote={() => void stopVoiceNote()}
          micPermissionDenied={micPermissionDenied}
          onRetake={retakePhoto}
          onAnalyse={() => void submitAnalysis(phase.draft)}
        />
      </View>
    );
  }

  // phase.phase === 'camera' from here down.

  if (!cameraPermission) {
    return <View style={styles.screen} />;
  }

  if (!cameraPermission.granted) {
    return (
      <CaptureStatusScreen
        title="Camera access needed"
        message={
          cameraPermission.canAskAgain
            ? 'Joule needs the camera to photograph your meal.'
            : 'Camera permission was denied. You can still log this food manually, or pick a photo from your gallery.'
        }
        actions={[
          ...(cameraPermission.canAskAgain
            ? [{ label: 'Grant camera access', onPress: () => void requestCameraPermission() }]
            : []),
          { label: 'Pick from gallery instead', onPress: () => void pickFromGalleryAndReview(), variant: 'secondary' as const },
          { label: 'Enter manually instead', onPress: goToManualEntry, variant: 'secondary' as const },
        ]}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" ref={setCameraRef} />
      <View style={[styles.overlay, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <CaptureDateBanner date={date} />
        <CaptureHint>Photograph the plate — you'll add context after</CaptureHint>

        {showPotNudge && (
          <Pressable
            onPress={goToPotFromNudge}
            style={({ pressed }) => [styles.potNudge, pressed && styles.potNudgePressed]}
            accessibilityRole="button"
          >
            <Text style={styles.potNudgeText}>Log from your pot instead — it&apos;s more accurate</Text>
            <Pressable onPress={dismissPotNudgeBanner} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss">
              <Text style={styles.potNudgeDismiss}>{'✕'}</Text>
            </Pressable>
          </Pressable>
        )}

        <View style={styles.spacer} />

        <CaptureControlBar
          onShutterPress={() => void capturePhotoAndReview()}
          onGalleryPress={() => void pickFromGalleryAndReview()}
          onManualEntryPress={goToManualEntry}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  spacer: {
    flex: 1,
  },
  potNudge: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '100%',
  },
  potNudgePressed: {
    opacity: 0.85,
  },
  potNudgeText: {
    ...type.caption,
    color: colors.accent,
    flexShrink: 1,
  },
  potNudgeDismiss: {
    ...type.caption,
    color: colors.textSecondary,
  },
});
