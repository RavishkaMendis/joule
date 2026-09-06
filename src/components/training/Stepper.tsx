// ═══════════════════════════════════════════════════════════════════════
// Stepper — big +/- touch targets around a tap-to-type number.
//
// Gym logging happens one-handed, between sets, often with a chalked or
// sweaty thumb (task brief: "optimise ruthlessly for that"). The +/-
// buttons are the primary interaction (a normal weight/rep bump is one or
// two taps); tapping the number itself drops into a plain numeric
// TextInput for the rare case of typing an exact value directly, keeping
// the keyboard as the fallback rather than the default.
//
// Buttons are 56dp square — comfortably past the 44dp minimum
// (theme.minTouchTarget) — because a stepper mashed between sets needs
// more margin for error than an ordinary button.
// ═══════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, numeric, radii, spacing, type } from '../../lib/theme';

const BUTTON_SIZE = 56;

type Props = {
  label: string;
  value: number;
  step: number;
  min?: number;
  /** e.g. "kg", "reps" — shown after the number, not editable. */
  suffix?: string;
  onChange: (value: number) => void;
  /** How many decimal places to display/round to. Weight typically wants 1-2 (2.5kg plates), reps wants 0. */
  precision?: number;
};

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function formatValue(value: number, precision: number): string {
  return precision > 0 ? value.toFixed(precision).replace(/\.?0+$/, '') || '0' : String(Math.round(value));
}

export function Stepper({ label, value, step, min = 0, suffix, onChange, precision = 0 }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const commitEdit = () => {
    const parsed = Number(text.replace(',', '.'));
    if (Number.isFinite(parsed)) {
      onChange(Math.max(min, round(parsed, precision)));
    }
    setEditing(false);
  };

  const startEdit = () => {
    setText(formatValue(value, precision));
    setEditing(true);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => onChange(Math.max(min, round(value - step, precision)))}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          hitSlop={8}
        >
          <Text style={styles.buttonText}>–</Text>
        </Pressable>

        {editing ? (
          <TextInput
            style={styles.valueInput}
            value={text}
            onChangeText={setText}
            onBlur={commitEdit}
            onSubmitEditing={commitEdit}
            keyboardType="decimal-pad"
            autoFocus
            selectTextOnFocus
          />
        ) : (
          <Pressable onPress={startEdit} style={styles.valueDisplay} accessibilityRole="button" accessibilityLabel={`${label}, ${value}${suffix ?? ''}, tap to type a value`}>
            <Text style={styles.valueText}>
              {formatValue(value, precision)}
              {suffix ? <Text style={styles.suffix}> {suffix}</Text> : null}
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={() => onChange(round(value + step, precision))}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          hitSlop={8}
        >
          <Text style={styles.buttonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    ...type.caption,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    ...type.h1,
    color: colors.text,
    lineHeight: 32,
  },
  valueDisplay: {
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  valueText: {
    ...type.h1,
    ...numeric,
    color: colors.text,
  },
  suffix: {
    ...type.body,
    color: colors.textSecondary,
  },
  valueInput: {
    ...type.h1,
    ...numeric,
    color: colors.text,
    minWidth: 96,
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingVertical: spacing.xs,
  },
});
