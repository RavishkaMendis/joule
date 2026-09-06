// ═══════════════════════════════════════════════════════════════════════
// APP ROOT — navigator wiring.
//
// Tab navigator (Today / Trends / Foods) nested inside a root stack that
// layers modal routes on top (weight entry, food entry, weekly check-in,
// onboarding, restore offer, settings, pot create/serve) — matches the
// route shape declared in src/lib/navigation.ts.
//
// On first launch (no user_profile row yet), the app opens into
// RestoreOffer rather than straight into Onboarding — "restore from a
// backup" or "start fresh" (backup/restore task brief §4: this is the
// moment restore matters most, and the user won't think to go hunting in
// Settings for it before they've even met the app). RestoreOfferScreen
// pushes Onboarding itself if the user picks "start fresh"; Onboarding's
// own reset-to-Tabs-if-nothing-to-go-back-to logic still works unchanged
// since it just checks navigation.canGoBack(). Onboarding writes
// user_profile only (never targets, see src/lib/onboardingActions.ts),
// so Today already renders its "No targets set yet" state correctly
// afterwards — same as before this screen was inserted.
//
// Also runs the automatic backup snapshot (src/lib/backup/autoBackup.ts)
// on cold start and on every foreground transition. Both call sites are
// fire-and-forget (`void`, never awaited by anything that blocks
// rendering): the function is itself throttled to once/day, a no-op if
// no backup folder has been granted, and swallows every failure
// internally — see that file's header for why none of this may ever
// delay startup or surface as a crash/modal.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackParamList, TabParamList } from './src/lib/navigation';
import { colors } from './src/lib/theme';
import { getDatabase } from './src/lib/db';
import * as profileRepo from './src/db/repositories/profileRepo';
import { runAutoBackupIfDue } from './src/lib/backup/autoBackup';
import {
  configureForegroundPresentation,
  addWeighInResponseListener,
  wasLaunchedFromWeighInReminder,
} from './src/lib/notifications/scheduler';

import { TodayScreen } from './src/screens/TodayScreen';
import { TrendsScreen } from './src/screens/TrendsScreen';
import { FoodsScreen } from './src/screens/FoodsScreen';
import { WeightEntryScreen } from './src/screens/WeightEntryScreen';
import { FoodEntryScreen } from './src/screens/FoodEntryScreen';
import { WeeklyCheckInScreen } from './src/screens/WeeklyCheckInScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { RestoreOfferScreen } from './src/screens/RestoreOfferScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { PotCreateScreen } from './src/screens/PotCreateScreen';
import { PotLogServingScreen } from './src/screens/PotLogServingScreen';
import { PotIngredientsPhotoScreen } from './src/screens/PotIngredientsPhotoScreen';
import { PotBarcodeAddScreen } from './src/screens/PotBarcodeAddScreen';
import { PotQuickAccessScreen } from './src/screens/PotQuickAccessScreen';
import { SupplementsScreen } from './src/screens/SupplementsScreen';
import { SupplementFormScreen } from './src/screens/SupplementFormScreen';
import { ZeppImportScreen } from './src/screens/ZeppImportScreen';
// Strength training (Train tab) — PRD §1 non-goal reminder: none of these
// screens ever write a calorie-burn figure or touch day_intake/weight_log.
import { WorkoutHomeScreen } from './src/screens/WorkoutHomeScreen';
import { WorkoutSessionScreen } from './src/screens/WorkoutSessionScreen';
import { WorkoutExercisePickerScreen } from './src/screens/WorkoutExercisePickerScreen';
import { WorkoutExerciseHistoryScreen } from './src/screens/WorkoutExerciseHistoryScreen';
import { WorkoutDashboardScreen } from './src/screens/WorkoutDashboardScreen';
// Training programs/templates (schema v7) — editing surface, separate
// from the fast ad-hoc logging screens above (see navigation.ts's header
// for these routes).
import { ProgramsScreen } from './src/screens/ProgramsScreen';
import { ProgramDetailScreen } from './src/screens/ProgramDetailScreen';
import { ProgramFormScreen } from './src/screens/ProgramFormScreen';
import { ProgramDayScreen } from './src/screens/ProgramDayScreen';
import { ProgramDayFormScreen } from './src/screens/ProgramDayFormScreen';
import { ProgramExerciseFormScreen } from './src/screens/ProgramExerciseFormScreen';
// Capture routes (PRD §7) — five input paths, one shared ConfirmSheet.
import { BarcodeScanScreen } from './src/screens/BarcodeScanScreen';
import { LabelScanScreen } from './src/screens/LabelScanScreen';
import { MealPhotoScreen } from './src/screens/MealPhotoScreen';
import { VoiceLogScreen } from './src/screens/VoiceLogScreen';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

// Module-level ref (not a hook) so the notification-response listener —
// which is not itself a React component — can navigate without needing
// to be told about it. Standard react-navigation pattern for "navigate
// from outside a screen" (https://reactnavigation.org/docs/navigating-without-navigation-prop/).
const navigationRef = createNavigationContainerRef<RootStackParamList>();

function navigateToWeightEntry(): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('WeightEntry');
  }
}

const NAV_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    border: colors.border,
    text: colors.text,
    primary: colors.accent,
  },
};

// Icon glyphs per tab. Ionicons ships every name referenced below (verified
// against its bundled glyph map) — outline variant when inactive, filled
// variant when active, matching standard Android/iOS tab conventions.
type IoniconName = keyof typeof Ionicons.glyphMap;
const TAB_ICONS: Record<keyof TabParamList, { active: IoniconName; inactive: IoniconName }> = {
  Today: { active: 'home', inactive: 'home-outline' },
  Trends: { active: 'stats-chart', inactive: 'stats-chart-outline' },
  Train: { active: 'barbell', inactive: 'barbell-outline' },
  Foods: { active: 'restaurant', inactive: 'restaurant-outline' },
  // Registration point: if a new tab is added later (e.g. a dedicated
  // "Scan" tab for barcode/photo capture), add its icon names here — do
  // not guess at the route name until it's actually wired into
  // src/lib/navigation.ts's TabParamList.
};

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name as keyof TabParamList];
          return <Ionicons name={focused ? icons.active : icons.inactive} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Trends" component={TrendsScreen} />
      <Tab.Screen name="Train" component={WorkoutHomeScreen} />
      <Tab.Screen name="Foods" component={FoodsScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [hasProfile, setHasProfile] = useState(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await getDatabase();
      const profile = await profileRepo.getProfile(db);
      if (!cancelled) {
        setHasProfile(profile !== null);
        setCheckingProfile(false);
      }
      // Fire-and-forget: throttled to once/day internally, silent on any
      // failure, no-op if no backup folder has been granted yet (see
      // src/lib/backup/autoBackup.ts). Deliberately not awaited — must
      // never delay first paint.
      void runAutoBackupIfDue(db);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Weigh-in reminder wiring (morning-reminder task) — this effect owns
  // exactly two things: (1) the in-foreground presentation config, so the
  // reminder still shows (quietly) if it happens to fire while Joule is
  // already open, and (2) the tap-response listener, so tapping the
  // notification lands on weight entry rather than just opening the app
  // (the cold-start case — app launched BY the tap — is handled via
  // NavigationContainer's `onReady` below, since navigationRef isn't
  // ready yet at the time this effect first runs).
  useEffect(() => {
    configureForegroundPresentation();
    const subscription = addWeighInResponseListener(navigateToWeightEntry);
    return () => subscription.remove();
  }, []);

  // "Write a full JSON snapshot on app foreground" (task brief §2) — cold
  // start is handled by the effect above; this covers backgrounding then
  // resuming without a full process restart (the common case on Android).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        void (async () => {
          const db = await getDatabase();
          void runAutoBackupIfDue(db);
        })();
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, []);

  if (checkingProfile) {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingScreen}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <NavigationContainer
          ref={navigationRef}
          theme={NAV_THEME}
          onReady={() => {
            // Cold start via notification tap: the response listener above
            // was registered after this launch already happened, so it
            // can't catch the event that caused it — this is the one
            // additional check that covers that case (see
            // scheduler.ts's wasLaunchedFromWeighInReminder for why).
            if (wasLaunchedFromWeighInReminder()) {
              navigateToWeightEntry();
            }
          }}
        >
          <Stack.Navigator
            initialRouteName={hasProfile ? 'Tabs' : 'RestoreOffer'}
            screenOptions={{
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.text,
              headerShadowVisible: false,
            }}
          >
            <Stack.Screen name="Tabs" component={TabNavigator} options={{ headerShown: false }} />
            <Stack.Screen name="WeightEntry" component={WeightEntryScreen} options={{ presentation: 'modal', title: 'Weight' }} />
            <Stack.Screen name="FoodEntry" component={FoodEntryScreen} options={{ presentation: 'modal', title: 'Food entry' }} />
            <Stack.Screen name="WeeklyCheckIn" component={WeeklyCheckInScreen} options={{ presentation: 'fullScreenModal', headerShown: false }} />
            <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="RestoreOffer" component={RestoreOfferScreen} options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
            <Stack.Screen
              name="PotCreate"
              component={PotCreateScreen}
              // Edit mode (task brief #4) reuses this same screen — the
              // header title is the one visible cue distinguishing
              // "New pot" from "Edit pot" before any content loads.
              options={({ route }) => ({ presentation: 'modal', title: route.params?.potId ? 'Edit pot' : 'New pot' })}
            />
            <Stack.Screen name="PotLogServing" component={PotLogServingScreen} options={{ presentation: 'modal', title: 'Log serving' }} />
            <Stack.Screen name="PotIngredientsPhoto" component={PotIngredientsPhotoScreen} options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="PotBarcodeAdd" component={PotBarcodeAddScreen} options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="PotQuickAccess" component={PotQuickAccessScreen} options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="Supplements" component={SupplementsScreen} options={{ title: 'Supplements' }} />
            <Stack.Screen name="SupplementForm" component={SupplementFormScreen} options={{ presentation: 'modal', title: 'Supplement' }} />
            <Stack.Screen name="ZeppImport" component={ZeppImportScreen} options={{ title: 'Import Zepp data' }} />
            {/* Strength training (Train tab) — WorkoutSession doubles as both
                "log live" and "edit a past session" (see navigation.ts). */}
            <Stack.Screen name="WorkoutSession" component={WorkoutSessionScreen} options={{ title: 'Workout' }} />
            <Stack.Screen name="WorkoutExercisePicker" component={WorkoutExercisePickerScreen} options={{ presentation: 'modal', title: 'Add exercise' }} />
            <Stack.Screen name="WorkoutExerciseHistory" component={WorkoutExerciseHistoryScreen} options={{ title: 'History' }} />
            <Stack.Screen name="WorkoutDashboard" component={WorkoutDashboardScreen} options={{ title: 'Progress' }} />
            {/* Training programs/templates — settings-shaped editing surface (task brief: "clarity beats speed" here), separate from the fast ad-hoc logging screens above. */}
            <Stack.Screen name="Programs" component={ProgramsScreen} options={{ title: 'Programs' }} />
            <Stack.Screen name="ProgramDetail" component={ProgramDetailScreen} options={{ title: 'Program' }} />
            <Stack.Screen name="ProgramForm" component={ProgramFormScreen} options={{ presentation: 'modal', title: 'Program' }} />
            <Stack.Screen name="ProgramDay" component={ProgramDayScreen} options={{ title: 'Day' }} />
            <Stack.Screen name="ProgramDayForm" component={ProgramDayFormScreen} options={{ presentation: 'modal', title: 'Day' }} />
            <Stack.Screen name="ProgramExerciseForm" component={ProgramExerciseFormScreen} options={{ presentation: 'modal', title: 'Exercise' }} />
          {/*
            Capture routes. Camera-based paths hide the header so the
            viewfinder is unobstructed; voice keeps a title since it's a
            simple hold-to-record surface, not a full-bleed preview.
          */}
          <Stack.Screen name="BarcodeScan" component={BarcodeScanScreen} options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="LabelScan" component={LabelScanScreen} options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="MealPhoto" component={MealPhotoScreen} options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="VoiceLog" component={VoiceLogScreen} options={{ presentation: 'modal', title: 'Voice' }} />
            {/* Route registration point: barcode scan, label OCR, meal photo,
                and voice log screens land here once their owning agents
                finish (src/lib/foodSources/**, src/lib/ai/**,
                BarcodeScanScreen/LabelScanScreen/MealPhotoScreen/
                VoiceLogScreen). Wire them as `presentation: 'modal'`
                Stack.Screen entries consistent with FoodEntry/PotCreate
                above — do not guess at their route names ahead of time. */}
          </Stack.Navigator>
        </NavigationContainer>
        <StatusBar style="light" />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
  },
});
