// ═══════════════════════════════════════════════════════════════════════
// RestTimer — a simple between-sets countdown. `key`-remountable by the
// parent (WorkoutSessionScreen restarts it by changing `startSignal`) so
// logging a set can kick off a fresh countdown without this component
// needing to know anything about sets/exercises.
//
// Deliberately no alarm sound/vibration wiring here (expo-av/haptics are
// outside this task's owned surface) — the visible countdown plus a
// colour change at zero is enough for a first version; audio cues are a
// natural follow-up, not a blocker.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../../lib/theme';

const DEFAULT_SECONDS = 90;
const STEP_SECONDS = 15;

function formatTime(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Props = {
  /** Changing this value restarts the countdown from `initialSeconds` — the parent bumps it after logging a set. */
  startSignal?: number;
  initialSeconds?: number;
};

export function RestTimer({ startSignal, initialSeconds = DEFAULT_SECONDS }: Props) {
  const [duration, setDuration] = useState(initialSeconds);
  const [remaining, setRemaining] = useState(initialSeconds);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-(re)start whenever the parent bumps startSignal (a set was just logged).
  useEffect(() => {
    if (startSignal === undefined) return;
    setRemaining(duration);
    setRunning(true);
    // duration intentionally omitted: only startSignal should trigger a restart.
  }, [startSignal]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          setRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const adjust = (deltaSeconds: number) => {
    setDuration((prev) => Math.max(STEP_SECONDS, prev + deltaSeconds));
    setRemaining((prev) => Math.max(0, prev + deltaSeconds));
  };

  const toggle = () => {
    if (remaining === 0) {
      setRemaining(duration);
      setRunning(true);
    } else {
      setRunning((r) => !r);
    }
  };

  const reset = () => {
    setRunning(false);
    setRemaining(duration);
  };

  const done = remaining === 0;

  return (
    <View style={styles.container}>
      <Pressable onPress={() => adjust(-STEP_SECONDS)} style={styles.stepButton} accessibilityRole="button" accessibilityLabel="15 seconds less rest">
        <Text style={styles.stepText}>−15</Text>
      </Pressable>

      <Pressable onPress={toggle} style={styles.timeButton} accessibilityRole="button" accessibilityLabel={running ? 'Pause rest timer' : 'Start rest timer'}>
        <Text style={[styles.time, done && styles.timeDone]}>{formatTime(remaining)}</Text>
        <Text style={styles.state}>{done ? 'rest done' : running ? 'resting' : 'rest timer'}</Text>
      </Pressable>

      <Pressable onPress={() => adjust(STEP_SECONDS)} style={styles.stepButton} accessibilityRole="button" accessibilityLabel="15 seconds more rest">
        <Text style={styles.stepText}>+15</Text>
      </Pressable>

      <Pressable onPress={reset} style={styles.resetButton} accessibilityRole="button" accessibilityLabel="Reset rest timer" hitSlop={8}>
        <Text style={styles.resetText}>Reset</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  stepButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stepText: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  timeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
    paddingVertical: spacing.xs,
  },
  time: {
    ...type.h1,
    ...numeric,
    color: colors.text,
  },
  timeDone: {
    color: colors.accent,
  },
  state: {
    ...type.small,
    color: colors.textTertiary,
  },
  resetButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  resetText: {
    ...type.caption,
    color: colors.textTertiary,
  },
});
