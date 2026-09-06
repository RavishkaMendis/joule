// ═══════════════════════════════════════════════════════════════════════
// PotIngredientsPhotoScreen — PRD §7.5 / task brief "meal-prep workflow":
// "Photograph the ingredients (raw, pre-cook) and have Gemini identify
// them into an editable ingredient list."
//
// Deliberately self-contained rather than reusing src/lib/captureJobs or
// src/components/capture/** (both off-limits to this feature — they're
// tightly coupled to the four existing capture paths and owned by
// concurrent agents). This is a much simpler flow than those: one photo,
// one Gemini call, then straight back to PotCreateScreen with the result
// — no review/annotate step, no continuous-capture basket, no background
// job queue. `runPotIngredientsPhoto` (src/lib/ai/runs.ts) reuses the
// exact same `callGeminiStructured` plumbing and kJ/plausibility rail as
// every other AI path; only the prompt (and this screen) are new.
//
// PRD §7's "always a human beat before save" applies here exactly like
// everywhere else: this screen never creates the pot or writes anything.
// It only ever hands PotCreateScreen a batch of EDITABLE draft rows —
// every field (name, raw grams, kcal, macros) stays a plain text input
// there, identical to a manually typed ingredient.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraCapturedPicture } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PotIngredientDraftParam, RootStackParamList } from '../lib/navigation';
import { colors, minTouchTarget, radii, spacing, type } from '../lib/theme';
import { hasGeminiApiKey, MISSING_KEY_MESSAGE } from '../lib/ai/apiKey';
import { runPotIngredientsPhoto } from '../lib/ai/runs';
import { describeAiFailure } from '../lib/captureJobs/jobReducer';
import { generateId } from '../lib/ids';
import { pendingEntryToDraftParam } from '../lib/potActions';

type Nav = NativeStackNavigationProp<RootStackParamList, 'PotIngredientsPhoto'>;

type Phase = { phase: 'camera' } | { phase: 'analysing' } | { phase: 'error'; message: string };

export function PotIngredientsPhotoScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const [phase, setPhase] = useState<Phase>({ phase: 'camera' });

  const backToPotCreate = useCallback(() => navigation.goBack(), [navigation]);

  const analyse = useCallback(
    async (base64: string) => {
      setPhase({ phase: 'analysing' });
      const result = await runPotIngredientsPhoto(base64);

      if (!result.ok) {
        // Use the shared, EXHAUSTIVE mapping rather than a local ternary
        // chain. A ternary silently collapses any unhandled reason into
        // the generic network message — which is exactly what happened
        // when the proxy transport added `proxy_unauthorized` and
        // `proxy_model_not_permitted`: a token misconfiguration would
        // have told the user to check their connection. `describeAiFailure`
        // is a switch over the full union, so a future reason is a compile
        // error here instead of a quietly wrong message.
        const message =
          result.reason === 'no_items'
            ? "Couldn't make out any ingredients in that photo — try again with better light, or add them manually."
            : describeAiFailure('meal_photo', result);
        setPhase({ phase: 'error', message });
        return;
      }

      const draftIngredients: PotIngredientDraftParam[] = result.entries.map((e) => pendingEntryToDraftParam(e));
      // BUG FIX (same class as PotBarcodeAddScreen's — see its handleAddNew
      // comment): React Navigation v7's `navigate()` no longer pops back to
      // an existing same-named route unless it's already focused, so this
      // used to PUSH a second, blank PotCreateScreen instead of returning
      // to the in-progress one — losing the pot's name/cooked weight/every
      // other ingredient from the user's perspective. `popTo` is v7's
      // dedicated "go back to this screen, merging params" action.
      navigation.popTo('PotCreate', { draftIngredients, draftKey: generateId('draft') }, { merge: true });
    },
    [navigation]
  );

  const capturePhoto = useCallback(async () => {
    if (!cameraRef) return;
    try {
      const photo: CameraCapturedPicture = await cameraRef.takePictureAsync({ base64: true, quality: 0.7 });
      if (!photo.base64) return;
      await analyse(photo.base64);
    } catch {
      // Capture failed transiently — stay on camera so the user can retry the shutter.
    }
  }, [cameraRef, analyse]);

  const pickFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (!asset.base64) return;
    await analyse(asset.base64);
  }, [analyse]);

  if (!hasGeminiApiKey()) {
    return (
      <View style={[styles.statusScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.statusTitle}>Ingredient photo unavailable</Text>
        <Text style={styles.statusMessage}>{MISSING_KEY_MESSAGE}</Text>
        <Pressable onPress={backToPotCreate} style={styles.statusButton} accessibilityRole="button">
          <Text style={styles.statusButtonText}>Back to manual entry</Text>
        </Pressable>
      </View>
    );
  }

  if (phase.phase === 'analysing') {
    return (
      <View style={[styles.statusScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.statusMessage}>Identifying ingredients…</Text>
      </View>
    );
  }

  if (phase.phase === 'error') {
    return (
      <View style={[styles.statusScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.statusTitle}>Couldn&apos;t read that photo</Text>
        <Text style={styles.statusMessage}>{phase.message}</Text>
        <Pressable onPress={() => setPhase({ phase: 'camera' })} style={styles.statusButton} accessibilityRole="button">
          <Text style={styles.statusButtonText}>Try again</Text>
        </Pressable>
        <Pressable onPress={backToPotCreate} style={styles.statusButtonSecondary} accessibilityRole="button">
          <Text style={styles.statusButtonSecondaryText}>Add ingredients manually instead</Text>
        </Pressable>
      </View>
    );
  }

  if (!cameraPermission) {
    return <View style={styles.screen} />;
  }

  if (!cameraPermission.granted) {
    return (
      <View style={[styles.statusScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.statusTitle}>Camera access needed</Text>
        <Text style={styles.statusMessage}>
          {cameraPermission.canAskAgain
            ? 'Joule needs the camera to photograph raw ingredients.'
            : 'Camera permission was denied. You can still pick a photo from your gallery, or add ingredients manually.'}
        </Text>
        {cameraPermission.canAskAgain && (
          <Pressable onPress={() => void requestCameraPermission()} style={styles.statusButton} accessibilityRole="button">
            <Text style={styles.statusButtonText}>Grant camera access</Text>
          </Pressable>
        )}
        <Pressable onPress={() => void pickFromGallery()} style={styles.statusButtonSecondary} accessibilityRole="button">
          <Text style={styles.statusButtonSecondaryText}>Pick from gallery instead</Text>
        </Pressable>
        <Pressable onPress={backToPotCreate} style={styles.statusButtonSecondary} accessibilityRole="button">
          <Text style={styles.statusButtonSecondaryText}>Add ingredients manually instead</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" ref={setCameraRef} />
      <View style={[styles.overlay, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.hintPill}>
          <Text style={styles.hintText}>Lay out the RAW ingredients — before cooking, before oil goes in</Text>
        </View>

        <View style={styles.spacer} />

        <View style={styles.controlRow}>
          <Pressable onPress={() => void pickFromGallery()} style={styles.smallButton} accessibilityRole="button">
            <Text style={styles.smallButtonText}>Gallery</Text>
          </Pressable>
          <Pressable onPress={() => void capturePhoto()} style={styles.shutter} accessibilityRole="button" accessibilityLabel="Take photo" />
          <Pressable onPress={backToPotCreate} style={styles.smallButton} accessibilityRole="button">
            <Text style={styles.smallButtonText}>Cancel</Text>
          </Pressable>
        </View>
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
  hintPill: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  hintText: {
    ...type.caption,
    color: colors.text,
  },
  spacer: {
    flex: 1,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.text,
    borderWidth: 4,
    borderColor: colors.surfaceAlt,
  },
  smallButton: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  smallButtonText: {
    ...type.caption,
    color: colors.text,
  },
  statusScreen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  statusTitle: {
    ...type.h2,
    color: colors.text,
    textAlign: 'center',
  },
  statusMessage: {
    ...type.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  statusButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  statusButtonText: {
    ...type.bodyStrong,
    color: colors.background,
  },
  statusButtonSecondary: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  statusButtonSecondaryText: {
    ...type.body,
    color: colors.accent,
  },
});
