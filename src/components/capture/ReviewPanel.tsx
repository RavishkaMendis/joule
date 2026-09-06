// ═══════════════════════════════════════════════════════════════════════
// ReviewPanel — the new "review" phase for MealPhotoScreen. Reported bug
// #1: the "what is it?" field used to sit BEFORE capture; the user wants
// to shoot/pick the photo FIRST, then add context, which is also the
// only order that makes sense for a gallery pick.
//
// Shows the captured/picked photo, a pre-focused text field for context
// ("chicken sushi", "5 pieces", "fried in 2 tbsp oil"), the existing
// hold-to-record voice note control, retake/re-pick, and a single
// unambiguous "Analyse" action.
//
// PRD §9.1's 10-second test still governs: analysing with no annotation
// must stay a single tap from here — "Analyse" is always enabled and
// always visible, never gated behind filling in the text field.
//
// ─── Keyboard-hides-the-field bug (reported 3 times) ─────────────────────
// A previous pass shipped this as a full-bleed overlay: the photo filled
// the entire screen via `StyleSheet.absoluteFill`, with a scrim, a
// floating top bar, and this panel's note field pinned to the bottom via
// `marginTop: 'auto'` — all riding on Android's `windowSoftInputMode:
// "resize"` (app.json) to shrink the window and let flexbox reposition
// the sheet when the keyboard opens, with `KeyboardAvoidingView`
// contributing nothing on Android (`behavior={undefined}` there is a
// plain View — no-op).
//
// That is the ONE capture-adjacent screen in the app built that way.
// Every other text-entry screen (FoodEntryScreen, OnboardingScreen,
// PotCreateScreen, WeightEntryScreen) pairs `KeyboardAvoidingView` with a
// real `ScrollView`, and none of them use full-screen absolute
// positioning for their content. That pairing is what actually saves
// them on Android: even where `adjustResize` under-delivers (it
// reliably does on this stack — RN/RNScreens' own resize propagation
// through a `react-native-screens` native Screen is not guaranteed to
// reach a nested absolutely-positioned layer), a genuine `ScrollView`
// gives Android's native "scroll the focused input into view" behaviour
// something to act on. A `marginTop: 'auto'` sheet floating over an
// absolute-fill sibling has no such fallback — if the window doesn't
// visually resize, nothing here ever would have moved, no matter how
// correct the `behavior` prop looked.
//
// The fix: stop treating the photo as a full-bleed background at all.
// It's a captured still, not a live camera feed — it can lay out like
// any other image. This panel is now a plain top-to-bottom document
// (photo, then form) inside `KeyboardAvoidingView` + `ScrollView`,
// exactly the pattern proven on the other four screens. The "Retake"
// button now overlays only the photo's own (bounded, aspect-ratio-sized)
// box, not the whole screen, so nothing here is absolutely positioned
// against an ancestor larger than the element it decorates.
// ═══════════════════════════════════════════════════════════════════════

import { useRef } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, minTouchTarget, radii, spacing, type } from '../../lib/theme';
import type { CapturedPhoto } from './capturePhases';

type Props = {
  photo: CapturedPhoto;
  textNote: string;
  onChangeTextNote: (value: string) => void;
  isRecordingVoiceNote: boolean;
  hasVoiceNote: boolean;
  onStartVoiceNote: () => void;
  onStopVoiceNote: () => void;
  micPermissionDenied: boolean;
  onRetake: () => void;
  onAnalyse: () => void;
};

export function ReviewPanel({
  photo,
  textNote,
  onChangeTextNote,
  isRecordingVoiceNote,
  hasVoiceNote,
  onStartVoiceNote,
  onStopVoiceNote,
  micPermissionDenied,
  onRetake,
  onAnalyse,
}: Props) {
  // Pre-focused per the task brief ("a text field pre-focused for
  // context") — the review phase's whole point is that context now has
  // somewhere useful to land the instant it appears.
  const inputRef = useRef<TextInput>(null);

  return (
    // Same convention as FoodEntryScreen/OnboardingScreen/PotCreateScreen/
    // WeightEntryScreen: KeyboardAvoidingView (padding on iOS; Android
    // leans on windowSoftInputMode "resize" from app.json) wrapping a real
    // ScrollView. See the file header for why the previous full-bleed
    // overlay + marginTop:'auto' sheet didn't get this fallback and this
    // one does.
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.photoWrap}>
          <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" />
          <Pressable onPress={onRetake} style={styles.retakeButton} accessibilityRole="button" accessibilityLabel="Retake or choose a different photo">
            <Text style={styles.retakeText}>‹ Retake</Text>
          </Pressable>
        </View>

        <View style={styles.form}>
          {micPermissionDenied && (
            <Text style={styles.permissionWarning}>
              Microphone permission was denied — you can still analyse with just the photo and any typed note.
            </Text>
          )}

          <View style={styles.noteRow}>
            <TextInput
              ref={inputRef}
              autoFocus
              style={styles.noteInput}
              value={textNote}
              onChangeText={onChangeTextNote}
              placeholder="What is it? e.g. chicken sushi, 5 pieces, 2 tbsp oil"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={onAnalyse}
              accessibilityLabel="Describe the meal to help the estimate"
              multiline
            />
            <Pressable
              onPressIn={onStartVoiceNote}
              onPressOut={onStopVoiceNote}
              style={[styles.micButton, isRecordingVoiceNote && styles.micButtonActive]}
              accessibilityRole="button"
              accessibilityLabel="Hold to add a voice note about quantities"
            >
              <Text style={styles.micButtonText}>{isRecordingVoiceNote ? '●' : '🎤'}</Text>
            </Pressable>
          </View>

          {hasVoiceNote && !isRecordingVoiceNote && (
            <Text style={styles.voiceNoteBadge}>Voice note attached</Text>
          )}

          <Pressable onPress={onAnalyse} style={({ pressed }) => [styles.analyseButton, pressed && styles.analyseButtonPressed]} accessibilityRole="button">
            <Text style={styles.analyseButtonText}>Analyse</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  photoWrap: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.surface,
  },
  photo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  retakeButton: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    minHeight: minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  retakeText: {
    ...type.body,
    color: colors.text,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  form: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  permissionWarning: {
    ...type.caption,
    color: colors.textSecondary,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  noteInput: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: minTouchTarget,
    maxHeight: 96,
    flex: 1,
  },
  micButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonActive: {
    backgroundColor: colors.accent,
  },
  micButtonText: {
    fontSize: 18,
  },
  voiceNoteBadge: {
    ...type.caption,
    color: colors.accent,
  },
  analyseButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  analyseButtonPressed: {
    opacity: 0.85,
  },
  analyseButtonText: {
    ...type.bodyStrong,
    color: colors.background,
  },
});
