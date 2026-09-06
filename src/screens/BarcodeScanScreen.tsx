// ═══════════════════════════════════════════════════════════════════════
// BarcodeScanScreen — PRD §7.2: "expo-camera -> Open Food Facts ->
// confirmation sheet. On miss, offer label OCR immediately in the same
// flow. Never dead-end the user."
//
// Uses expo-camera's built-in `onBarcodeScanned` (PRD §2: "no separate
// scanner lib"). Runs the full priority cascade (saved_food -> AFCD gap
// -> Open Food Facts) via lookupByBarcode, then renders the ONE shared
// ConfirmSheet. Camera permission denial routes to manual entry instead of
// showing a blank/broken camera view.
//
// Shares the same visual family as MealPhotoScreen/LabelScanScreen (the
// hint pill, permission/error card, safe-area-aware chrome) via
// src/components/capture/*, even though this screen's capture is passive
// (onBarcodeScanned) rather than a shutter press, so all three read as
// one family.
//
// Date threading: reads `route.params.date` — the date TodayScreen was
// showing when this route was opened — and falls back to today only when
// that param is absent (deep link / older caller). `CaptureDateBanner`
// makes a non-today date visible on every phase of this screen rather
// than changing it silently.
//
// ── CONTINUOUS SCANNING (task brief #2) ──────────────────────────────
// Real-use complaint: "I scan bread, log it, then have to scan the jam
// separately — can't do both in one go." A successful lookup now appends
// to a running `basket` and the camera stays live (`onBarcodeScanned`
// keeps firing) rather than immediately handing off to ConfirmSheet.
// A compact running list (name + kcal) plus a prominent "Done (N)" button
// sits over the camera; tapping it opens the ONE shared ConfirmSheet with
// the whole basket — which already assigns a shared meal_group_id and
// offers meal naming at 2+ items (mealName.ts / ConfirmSheet), so nothing
// about that machinery is reimplemented here.
//
// 10-second test (PRD §9.1) — the single-scan case still auto-surfaces
// the "Done (1)" action immediately, one prominent tap away, exactly
// where the scan-accepted feedback already draws the eye; there is no
// hidden menu or extra screen between "scanned" and "reviewing in
// ConfirmSheet". The brief's own framing is explicit that the governing
// constraint is a TIME budget ("if logging a repeat meal takes longer
// than 10 seconds"), not a raw tap count, so one large always-visible
// "Done" button does not regress it.
//
// Debounce (task brief ⚠️, BUG 3 — real double-add report: "scans the
// same item twice because it's so fast"): expo-camera's onBarcodeScanned
// fires repeatedly while a code sits in frame. `scanDebounce.ts`'s
// `shouldAcceptScan` (pure, unit-tested) rejects a repeat of the same
// barcode that is still being continuously sighted; a genuinely different
// barcode is always accepted immediately. `recordSighting` is called on
// EVERY firing below (accepted or not) — see scanDebounce.ts's header for
// why that, not a longer fixed window, is what actually closes the
// reported bug (a prolonged dwell no longer re-triggers just because a
// clock elapsed). Each accepted scan shows a brief "Added" pill
// (`justAdded`) with an inline "Undo", so the user gets visible
// confirmation it registered AND an immediate way to reverse a mistake,
// per the brief's explicit requirement. `removeBasketItem`/
// `handleRemoveBasketItem` (BUG 3's other half, "doesn't let me remove
// one") give a per-item remove control in the running basket too — both
// are id-keyed pure functions, independent of `ScanDebounceState`, so a
// removal can never disturb the ability to re-scan that same barcode.
//
// ── RETICLE ALIGNMENT (defect #1) ────────────────────────────────────
// User report: "the focus is on middle but the scan part is at the
// top." Checked expo-camera's installed types (Camera.types.d.ts):
// `BarcodeSettings`/`ScanningOptions` expose only `barcodeTypes` — there
// is no region/rect field on either Android or iOS in this version, so
// `onBarcodeScanned` genuinely reads the FULL camera frame, not whatever
// area the guide box happens to be drawn over. The box was previously
// pinned near the top (first child of `overlay`, right after the safe-
// area padding) while the rest of the chrome sat at the bottom, so the
// guide visually promised a top-of-frame scan zone that doesn't exist.
// Since there's no real API to restrict detection to match a top-
// positioned box (and fabricating one would just move the lie), the fix
// goes the other way: the reticle is now centred in the space between
// the top banners and the bottom chrome, matching where full-frame
// detection actually succeeds and where a phone is naturally aimed when
// held up one-handed. `reticleArea` (flex:1, centered) replaces the old
// top-pinned `scanFrame` + bottom `spacer` split.

//
// Miss-inside-a-batch handling (task brief: "Decide and state how you
// handled it" — see also the task's final report): with an EMPTY basket,
// a miss behaves exactly as before — the full-screen ConfirmSheet opens
// with `fallbackAction` routing to label OCR, since there is nothing to
// protect. With a NON-EMPTY basket, a miss must not destroy it, so it is
// rendered as a small dismissable inline banner over the still-live
// camera (offering "Scan the label instead" as a link, not a full-screen
// takeover) while the basket and camera stream are left completely
// untouched — the user can dismiss it and keep scanning, or follow the
// label link without losing already-collected items.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import { resolveCaptureDate } from '../lib/dateNav';
import { lookupByBarcode, type CascadeMissReason } from '../lib/foodSources/lookupCascade';
import { INITIAL_SCAN_DEBOUNCE_STATE, recordSighting, shouldAcceptScan, type ScanDebounceState } from '../lib/foodSources/scanDebounce';
import { generateId } from '../lib/ids';
import { ConfirmSheet } from '../components/ConfirmSheet';
import type { PendingEntry } from '../lib/pendingEntry';
import { CaptureHint } from '../components/capture/CaptureHint';
import { CaptureStatusScreen } from '../components/capture/CaptureStatusScreen';
import { CaptureDateBanner } from '../components/capture/CaptureDateBanner';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'BarcodeScan'>;

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] as const;

type ScanState =
  | { phase: 'scanning' }
  | { phase: 'looking_up'; barcode: string }
  | { phase: 'confirming'; entries: PendingEntry[] }
  // Empty-basket miss only — see the header doc for why a non-empty-basket
  // miss takes the inline-banner path instead of this full-screen phase.
  | { phase: 'miss'; barcode: string; reason: CascadeMissReason };

/**
 * A basket entry keyed by a locally-generated id rather than by array
 * index (BUG 3 fix, "doesn't let me remove one"). The basket display only
 * ever renders the LAST 3 items (`basket.slice(-3)`), so an index-based
 * remove control would have to translate a slice-local index back into
 * the full array's index — a stable id sidesteps that class of bug
 * entirely and also gives the "Undo last add" action something durable
 * to target regardless of how many items come after it.
 */
export type BasketItem = { id: string; entry: PendingEntry };

/**
 * Pure basket-append — exported (alongside `removeBasketItem` below)
 * purely so the "removing an item must not disturb anything a later
 * re-scan needs" property (BUG 3 fix) is directly unit-testable without
 * mounting this screen's camera/permissions/navigation stack, matching
 * this repo's existing pattern of testing a screen's pure logic directly
 * (see OnboardingScreen.tsx's `validateOnboardingStep`).
 */
export function addBasketItem(basket: BasketItem[], id: string, entry: PendingEntry): BasketItem[] {
  return [...basket, { id, entry }];
}

/**
 * Pure basket-remove. Takes and returns ONLY basket state — it has no
 * parameter for, and cannot touch, `ScanDebounceState`. That is the
 * property under test in scanDebounce.test.ts's companion assertions:
 * removing an item can never leave the scanner unable to accept a fresh
 * scan of that same barcode, because there is no shared state for a
 * removal to corrupt in the first place.
 */
export function removeBasketItem(basket: BasketItem[], id: string): BasketItem[] {
  return basket.filter((b) => b.id !== id);
}

export function BarcodeScanScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const date = resolveCaptureDate(route.params?.date);
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<ScanState>({ phase: 'scanning' });

  // The running basket a continuous-scanning session builds up. Cleared
  // only on a successful confirm/cancel of the sheet — NOT on a miss, per
  // the miss-handling rule above. `basketRef` mirrors `basket` so the
  // async lookup callback below can read the CURRENT basket (e.g. "is it
  // empty right now?") without capturing a stale closure over whatever
  // `basket` was when the scan started — two scans can be in flight
  // (though `lookupInFlightRef` prevents overlap in practice) and the
  // miss-handling decision must reflect reality at resolution time, not
  // at call time.
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const basketRef = useRef<BasketItem[]>([]);
  // Transient "Added" feedback (task brief: "give brief visible feedback
  // on each accepted scan so the user knows it registered"), keyed by a
  // counter so a rapid string of distinct scans each restart the timer
  // rather than the second scan's feedback silently vanishing at the
  // first scan's original timeout. Carries the item's basket id too (BUG
  // 3 fix) so the "Undo" action attached to this pill has something exact
  // to remove — never "whatever's currently last", which could have
  // changed if another scan raced in.
  const [justAdded, setJustAdded] = useState<{ id: string; name: string } | null>(null);
  const justAddedTokenRef = useRef(0);
  // A non-empty-basket miss, rendered as a dismissable inline banner
  // rather than the full-screen `miss` phase (see header doc).
  const [missBanner, setMissBanner] = useState<{ message: string } | null>(null);

  const debounceRef = useRef<ScanDebounceState>(INITIAL_SCAN_DEBOUNCE_STATE);
  // Guards against overlapping in-flight lookups (e.g. two accepted scans
  // firing before the first lookup resolves) — independent of the
  // debounce predicate, which only decides whether a *read* is accepted.
  const lookupInFlightRef = useRef(false);

  const goToManualEntry = useCallback(() => {
    navigation.navigate('FoodEntry', { date });
  }, [navigation, date]);

  const showJustAdded = useCallback((id: string, name: string) => {
    justAddedTokenRef.current += 1;
    const token = justAddedTokenRef.current;
    setJustAdded({ id, name });
    setTimeout(() => {
      if (justAddedTokenRef.current === token) setJustAdded(null);
    }, 1200);
  }, []);

  /** Returns the new item's basket id so the caller can show "Added"/"Undo" feedback tied to exactly this item. */
  const appendToBasket = useCallback((entry: PendingEntry): string => {
    const id = generateId('scan');
    basketRef.current = addBasketItem(basketRef.current, id, entry);
    setBasket(basketRef.current);
    return id;
  }, []);

  // BUG 3 FIX ("doesn't let me remove one") — removes a single item by its
  // stable id, via the pure `removeBasketItem` above. Deliberately touches
  // ONLY basket state: the debounce ref (`debounceRef`) is a completely
  // separate piece of state that nothing here reads or writes, so removing
  // an item can never leave the scanner unable to accept a fresh scan of
  // that same barcode afterwards (see scanDebounce.test.ts and this
  // screen's own test file for that exact property).
  const handleRemoveBasketItem = useCallback((id: string) => {
    basketRef.current = removeBasketItem(basketRef.current, id);
    setBasket(basketRef.current);
    setJustAdded((current) => (current?.id === id ? null : current));
  }, []);

  // "Obvious undo for the item just added" (task brief) — a thin wrapper
  // over handleRemoveBasketItem scoped to whatever the current "Added"
  // pill refers to, so tapping it can never remove the WRONG item if
  // another scan has landed in the meantime (the pill itself would
  // already have moved on to that newer item by then, since
  // showJustAdded re-points it).
  const undoJustAdded = useCallback(() => {
    if (!justAdded) return;
    handleRemoveBasketItem(justAdded.id);
  }, [justAdded, handleRemoveBasketItem]);

  const clearBasket = useCallback(() => {
    basketRef.current = [];
    setBasket([]);
  }, []);

  const handleBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    const barcode = result.data;
    const now = Date.now();

    // BUG 3 FIX ("scans the same item twice because it's so fast") — see
    // scanDebounce.ts's header for the full root-cause diagnosis. The
    // sighting is recorded on EVERY firing, accepted or not, so
    // suppression lasts for the barcode's entire continuous dwell in
    // frame rather than a fixed window from first acceptance.
    const isNewSighting = shouldAcceptScan(debounceRef.current, barcode, now);
    debounceRef.current = recordSighting(barcode, now);
    if (!isNewSighting) return;
    if (lookupInFlightRef.current) return;

    lookupInFlightRef.current = true;
    setMissBanner(null);
    setState({ phase: 'looking_up', barcode });

    // Reports a miss, taking the inline-banner path when the basket
    // already has items (must not destroy the batch — see header doc)
    // and the full-screen fallback-to-OCR phase only when it's empty.
    const reportMiss = (reason: CascadeMissReason, message: string) => {
      if (basketRef.current.length > 0) {
        setMissBanner({ message });
        setState({ phase: 'scanning' });
      } else {
        setState({ phase: 'miss', barcode, reason });
      }
    };

    (async () => {
      const db = await getDatabase();
      const outcome = await lookupByBarcode(db, barcode);
      lookupInFlightRef.current = false;

      if (outcome.ok) {
        const id = appendToBasket(outcome.entry);
        showJustAdded(id, outcome.entry.name);
        setState({ phase: 'scanning' });
        return;
      }

      const message =
        outcome.reason === 'not_found'
          ? "Couldn't find that barcode in Open Food Facts."
          : outcome.reason === 'network_error'
            ? "Couldn't reach Open Food Facts — check your connection."
            : 'Got an unexpected response looking that up.';
      reportMiss(outcome.reason, message);
    })().catch(() => {
      lookupInFlightRef.current = false;
      reportMiss('network_error', "Couldn't reach Open Food Facts — check your connection.");
    });
  }, [appendToBasket, showJustAdded]);

  const resumeScanning = useCallback(() => {
    lookupInFlightRef.current = false;
    setState({ phase: 'scanning' });
  }, []);

  // Opens the ONE shared ConfirmSheet with everything the session has
  // collected so far — the "Done (N)" action. Reachable at basket size 1
  // (the ordinary single-scan case) exactly as readily as at size 2+.
  const openBasketForConfirm = useCallback(() => {
    setMissBanner(null);
    setState({ phase: 'confirming', entries: basket.map((b) => b.entry) });
  }, [basket]);

  const goToLabelOcr = useCallback(() => {
    // Owned by a different agent; route by name so this screen doesn't
    // depend on that screen's module existing yet. The navigator wiring
    // (App.tsx / navigation.ts) is done by the orchestrator.
    navigation.navigate('LabelScan' as never);
  }, [navigation]);

  // Hardware back during `looking_up` resolves the in-flight lookup back
  // to `scanning` explicitly rather than leaving an undefined spinner
  // state up — `scanning`/`confirming` defer to default navigation/Modal
  // behaviour (matches useCaptureBackHandler's phase in the other two
  // capture screens, kept inline here since this screen's state shape
  // predates and differs from the shared capture phase machine).
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (state.phase !== 'looking_up') return false;
        resumeScanning();
        return true;
      });
      return () => subscription.remove();
    }, [state.phase, resumeScanning])
  );

  if (!permission) {
    return <View style={styles.screen} />;
  }

  if (!permission.granted) {
    return (
      <CaptureStatusScreen
        title="Camera access needed"
        message={
          permission.canAskAgain
            ? 'Joule needs the camera to scan barcodes.'
            : 'Camera permission was denied. You can still log this food manually.'
        }
        actions={[
          ...(permission.canAskAgain ? [{ label: 'Grant camera access', onPress: () => void requestPermission() }] : []),
          { label: 'Enter manually instead', onPress: goToManualEntry, variant: 'secondary' as const },
        ]}
      />
    );
  }

  if (state.phase === 'confirming') {
    return (
      <ConfirmSheet
        entries={state.entries}
        date={date}
        onConfirm={async () => {
          clearBasket();
          navigation.goBack();
        }}
        onCancel={() => {
          // Cancelling the review does NOT discard the basket — it
          // returns to a live camera with everything still collected, so
          // the user can add/remove items and reopen via "Done" again.
          setState({ phase: 'scanning' });
        }}
        fallbackAction={undefined}
      />
    );
  }

  // Empty-basket miss only (see header doc) — unchanged from the
  // pre-existing full-screen behaviour.
  if (state.phase === 'miss') {
    const message =
      state.reason === 'not_found'
        ? "Couldn't find that barcode in Open Food Facts."
        : state.reason === 'network_error'
          ? "Couldn't reach Open Food Facts — check your connection."
          : 'Got an unexpected response looking that up.';

    return (
      <ConfirmSheet
        entries={[]}
        date={date}
        onConfirm={async () => {
          resumeScanning();
        }}
        onCancel={resumeScanning}
        fallbackAction={{ label: `${message} Scan the label instead →`, onPress: goToLabelOcr }}
      />
    );
  }

  const basketKcal = Math.round(basket.reduce((sum, b) => sum + b.entry.kcal, 0));

  return (
    <View style={styles.screen}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={handleBarcodeScanned}
      />
      <View style={[styles.overlay, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        {/* Centred in the remaining space (below), not pinned to the top —
            see the RETICLE ALIGNMENT note above. This is the only place
            in this file "where the guide sits" is decided; keep the
            feedback pill and miss banner attached to it so "Added"/miss
            feedback appears where the user is actually looking. */}
        <View style={styles.reticleArea}>
          <View style={styles.scanFrame} />

          {justAdded && (
            <View style={styles.justAddedPill} accessibilityLiveRegion="polite">
              <Text style={styles.justAddedText}>Added — {justAdded.name}</Text>
              {/* "Obvious undo for the item just added" (task brief, BUG 3) —
                  scoped to this exact item's id, not "whatever's last". */}
              <Pressable onPress={undoJustAdded} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Undo adding ${justAdded.name}`}>
                <Text style={styles.justAddedUndoText}>Undo</Text>
              </Pressable>
            </View>
          )}

          {missBanner && (
            <Pressable
              onPress={goToLabelOcr}
              style={({ pressed }) => [styles.missBanner, pressed && styles.missBannerPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.missBannerText}>{missBanner.message} Scan the label instead →</Text>
              <Pressable onPress={() => setMissBanner(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss">
                <Text style={styles.missBannerDismiss}>{'✕'}</Text>
              </Pressable>
            </Pressable>
          )}
        </View>

        {/* Bottom-docked chrome — thumb zone for a one-handed hold. No
            longer needs a flex spacer of its own: `reticleArea` above
            already consumes all the leftover vertical space. */}
        <View style={styles.bottomArea}>
          <CaptureDateBanner date={date} />

          {state.phase === 'looking_up' ? (
            <View style={styles.lookingUpRow}>
              <ActivityIndicator color={colors.accent} />
              <CaptureHint>Looking up…</CaptureHint>
            </View>
          ) : (
            <CaptureHint>Point the camera at a barcode</CaptureHint>
          )}

          {/* Running basket (task brief #2) — a compact name+kcal list plus
              the "Done (N)" action that opens ConfirmSheet with everything
              collected. Rendered ONLY once something has been scanned, so a
              fresh camera view looks exactly as it always did. */}
          {basket.length > 0 && (
            <View style={styles.basketCard}>
              {/* Per-item remove (BUG 3 fix, "doesn't let me remove one") —
                  keyed and removed by the item's stable `id`, never by its
                  position in this slice, so removing an item is always
                  correct regardless of how many items came before/after it
                  in the FULL basket. */}
              {basket.slice(-3).map((item) => (
                <View key={item.id} style={styles.basketItemRow}>
                  <Text style={styles.basketItemText} numberOfLines={1}>
                    {item.entry.name} · {Math.round(item.entry.kcal)} kcal
                  </Text>
                  <Pressable
                    onPress={() => handleRemoveBasketItem(item.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.entry.name}`}
                  >
                    <Text style={styles.basketItemRemove}>{'✕'}</Text>
                  </Pressable>
                </View>
              ))}
              {basket.length > 3 && <Text style={styles.basketMoreText}>+{basket.length - 3} more</Text>}
              <Pressable
                onPress={openBasketForConfirm}
                accessibilityRole="button"
                accessibilityLabel={`Done, review ${basket.length} scanned item${basket.length === 1 ? '' : 's'}, ${basketKcal} kcal total`}
                style={({ pressed }) => [styles.doneButton, pressed && styles.doneButtonPressed]}
              >
                <Text style={styles.doneButtonText}>Done ({basket.length})</Text>
              </Pressable>
            </View>
          )}

          {/* Matches the other two capture screens' single quiet centred
              manual-entry line (CaptureControlBar's manual link), without
              pulling in the full control bar — shutter/gallery make no
              sense for a passive barcode scan. */}
          <Pressable onPress={goToManualEntry} style={styles.manualEntryButton} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.manualEntryText}>Enter manually instead</Text>
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
  // Centres the reticle (+ its attached feedback) in whatever vertical
  // space is left once the top/bottom safe-area padding and the bottom
  // chrome are accounted for — see the RETICLE ALIGNMENT header note.
  reticleArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  bottomArea: {
    width: '100%',
    alignItems: 'center',
  },
  scanFrame: {
    width: 260,
    height: 160,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 10,
  },
  justAddedPill: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  justAddedText: {
    ...type.caption,
    color: colors.accent,
    fontWeight: '600',
  },
  justAddedUndoText: {
    ...type.caption,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  missBanner: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '100%',
  },
  missBannerPressed: {
    backgroundColor: colors.border,
  },
  missBannerText: {
    ...type.caption,
    color: colors.accent,
    flexShrink: 1,
  },
  missBannerDismiss: {
    ...type.caption,
    color: colors.textSecondary,
  },
  lookingUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  basketCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  basketItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  basketItemText: {
    ...type.caption,
    ...numeric,
    color: colors.text,
    flexShrink: 1,
  },
  basketItemRemove: {
    ...type.caption,
    color: colors.textTertiary,
  },
  basketMoreText: {
    ...type.small,
    color: colors.textTertiary,
  },
  doneButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  doneButtonPressed: {
    opacity: 0.85,
  },
  doneButtonText: {
    ...type.bodyStrong,
    ...numeric,
    color: colors.background,
  },
  manualEntryButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualEntryText: {
    ...type.body,
    color: colors.accent,
  },
});
