// ═══════════════════════════════════════════════════════════════════════
// LabelScanScreen — PRD §7.3, the workhorse in Australia.
//
// Photo of the Nutrition Information Panel -> Gemini (Flash-Lite) reads
// the per-100g column, detecting kcal vs kJ -> ONE shared ConfirmSheet.
// The user enters/edits grams consumed there; "save to my foods" is
// handled by the sheet itself on every successful scan (PRD §7.3).
//
// This screen doesn't need MealPhotoScreen's review/annotate step (there
// is nothing to annotate — the label is the source of truth), but it
// shared MealPhotoScreen's exact "dead end while analysing" bug: a
// gallery pick used to land straight on a static ActivityIndicator with
// no way back. Fixed the same way: `processing` renders the picked/shot
// photo dimmed behind ProcessingOverlay, with a Cancel action and the
// Android hardware back button (useCaptureBackHandler) both wired to
// return to `camera` rather than trapping the user. The camera-phase
// chrome, hint pill, and control row are shared with MealPhotoScreen/
// BarcodeScanScreen via src/components/capture/* so the three capture
// screens read as one family.
//
// PRD §7's non-negotiable rule applies here like everywhere else: this
// screen never calls foodRepo directly. `runLabelOcr` only ever returns
// PendingEntry[] for the ConfirmSheet to render and the user to confirm.
//
// Missing API key degrades gracefully: shows a plain "add a key" message
// and a link straight to manual entry, camera view never even mounts.
//
// Date threading (task fix): reads `route.params.date` — the date
// TodayScreen was showing when this route was opened — instead of always
// calling `todayLocalISO()`. A nutrition-label photo for something eaten
// yesterday is a legitimate backfill, not a live-capture-only action.
// `CaptureDateBanner` surfaces a non-today date plainly rather than
// silently changing which day this logs against.
//
// ─── Background analysis ─────────────────────────────────────────────
// Same src/lib/captureJobs wiring as MealPhotoScreen (see that file's
// header for the full mechanism/rationale) — `processPhoto` submits a
// job and returns immediately instead of awaiting `runLabelOcr` inline.
// A label scan is normally the fastest of the three AI paths (a few
// seconds, Flash-Lite, no vision-heavy meal-photo reasoning), so the
// common case is unaffected in feel: this screen stays subscribed via
// `useCaptureJob` and shows ConfirmSheet the moment it settles, same as
// before. The queue only becomes visible on a slow/flaky network, via
// ProcessingOverlay's new "Leave — I'll get notified" action.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraCapturedPicture } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, spacing } from '../lib/theme';
import { resolveCaptureDate } from '../lib/dateNav';
import { getDatabase } from '../lib/db';
import { ConfirmSheet } from '../components/ConfirmSheet';
import type { PendingEntry } from '../lib/pendingEntry';
import { hasGeminiApiKey, MISSING_KEY_MESSAGE } from '../lib/ai/apiKey';
import { dismissJob, submitJob, useCaptureJob, useWatchCaptureJob, type CaptureJobInput } from '../lib/captureJobs';
import {
  resetAfterConfirm,
  toCamera,
  toConfirming,
  toError,
  toProcessing,
  INITIAL_CAPTURE_PHASE,
  type CapturedPhoto,
  type CapturePhase,
} from '../components/capture/capturePhases';
import { CaptureControlBar } from '../components/capture/CaptureControlBar';
import { CaptureHint } from '../components/capture/CaptureHint';
import { CaptureStatusScreen } from '../components/capture/CaptureStatusScreen';
import { ProcessingOverlay } from '../components/capture/ProcessingOverlay';
import { CaptureDateBanner } from '../components/capture/CaptureDateBanner';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'LabelScan'>;

/**
 * LabelScanScreen has no `review`/annotate step (there is nothing to
 * annotate — see file header) and never carries a typed note, but it
 * reuses the phase machine's `processing`/`error` shape (with an empty
 * `textNote`/`hasVoiceNote: false` draft) purely so it can share
 * ProcessingOverlay with MealPhotoScreen instead of re-implementing an
 * equivalent dead-end fix twice. It does NOT reuse
 * useCaptureBackHandler/handleHardwareBack, since those resolve `error`
 * back to a genuine `review` phase this screen never renders — see the
 * screen-local back handler below instead, which only ever moves
 * between the phases this screen actually has.
 */
function toProcessingDraft(photo: CapturedPhoto): CapturePhase {
  return toProcessing({ phase: 'review', draft: { photo, textNote: '', hasVoiceNote: false } });
}

export function LabelScanScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const date = resolveCaptureDate(route.params?.date);
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<CapturePhase>(INITIAL_CAPTURE_PHASE);
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const [confirmEntries, setConfirmEntries] = useState<PendingEntry[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const activeJob = useCaptureJob(activeJobId);
  useWatchCaptureJob(activeJobId);

  const finishActiveJob = useCallback(async () => {
    if (!activeJobId) return;
    const db = await getDatabase();
    dismissJob(db, activeJobId);
    setActiveJobId(null);
  }, [activeJobId]);

  // Applies a watched job's eventual outcome — same mechanism as
  // MealPhotoScreen's identical effect; see that file's header.
  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === 'done') {
      setConfirmEntries(activeJob.entries ?? []);
      setPhase((prev) => toConfirming(prev));
    } else if (activeJob.status === 'error') {
      setPhase((prev) => toError(prev, activeJob.errorMessage ?? 'Something went wrong.'));
    }
  }, [activeJob]);

  // Hardware back: `processing` cancels back to `camera` (this screen has
  // no review phase to restore, unlike MealPhotoScreen); `error` also
  // goes back to `camera` (there is nothing else to retry into); `camera`
  // and `confirming` defer to default navigation/Modal behaviour. Both
  // of those transitions abandon the in-flight job (see cancelScan).
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (phase.phase === 'processing' || phase.phase === 'error') {
          void finishActiveJob();
          setPhase(toCamera());
          return true;
        }
        return false;
      });
      return () => subscription.remove();
    }, [phase.phase, finishActiveJob])
  );

  const goToManualEntry = useCallback(() => {
    navigation.navigate('FoodEntry', { date });
  }, [navigation, date]);

  const resetToCamera = useCallback(() => {
    void finishActiveJob();
    setPhase(resetAfterConfirm());
  }, [finishActiveJob]);
  const cancelScan = useCallback(() => {
    void finishActiveJob();
    setPhase(toCamera());
  }, [finishActiveJob]);
  const leaveScanInBackground = useCallback(() => {
    // Job keeps running — see MealPhotoScreen's identical action for why.
    navigation.goBack();
  }, [navigation]);
  const retryAfterError = useCallback(() => {
    void finishActiveJob();
    setPhase(toCamera());
  }, [finishActiveJob]);

  const processPhoto = useCallback(
    async (photo: CapturedPhoto) => {
      setPhase(toProcessingDraft(photo));
      const db = await getDatabase();
      const input: CaptureJobInput = { kind: 'label_ocr', photoUri: photo.uri, photoBase64: photo.base64 };
      const job = submitJob(db, date, input);
      setActiveJobId(job.id);
    },
    [date]
  );

  const handleCapture = useCallback(async () => {
    if (!cameraRef) return;
    try {
      const photo: CameraCapturedPicture = await cameraRef.takePictureAsync({ base64: true, quality: 0.7 });
      if (!photo.base64) return;
      await processPhoto({ uri: photo.uri, base64: photo.base64 });
    } catch {
      // Capture failed transiently — stay put so the user can just try
      // the shutter again rather than bouncing to an error screen.
    }
  }, [cameraRef, processPhoto]);

  const handlePickFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (!asset.base64) return;
    await processPhoto({ uri: asset.uri, base64: asset.base64 });
  }, [processPhoto]);

  if (!hasGeminiApiKey()) {
    return (
      <CaptureStatusScreen
        title="Label scan unavailable"
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
        title="Couldn't read that label"
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
    return (
      <ProcessingOverlay
        photo={phase.draft.photo}
        stages={['Reading the panel…', 'Checking kcal vs kJ…']}
        onCancel={cancelScan}
        onLeaveInBackground={leaveScanInBackground}
      />
    );
  }

  if (!permission) {
    return <View style={styles.screen} />;
  }

  if (!permission.granted) {
    return (
      <CaptureStatusScreen
        title="Camera access needed"
        message={
          permission.canAskAgain
            ? 'Joule needs the camera to photograph nutrition labels.'
            : 'Camera permission was denied. You can still log this food manually, or pick a photo from your gallery.'
        }
        actions={[
          ...(permission.canAskAgain ? [{ label: 'Grant camera access', onPress: () => void requestPermission() }] : []),
          { label: 'Pick from gallery instead', onPress: () => void handlePickFromGallery(), variant: 'secondary' as const },
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
        <View style={styles.scanFrame} />
        <CaptureHint>Frame the per-100g nutrition column</CaptureHint>

        <View style={styles.spacer} />

        <CaptureControlBar
          onShutterPress={() => void handleCapture()}
          onGalleryPress={() => void handlePickFromGallery()}
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
  scanFrame: {
    width: 300,
    height: 200,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 10,
    marginTop: spacing.xl,
  },
});
