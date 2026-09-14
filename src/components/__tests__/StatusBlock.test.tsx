// ═══════════════════════════════════════════════════════════════════════
// StatusBlock — coverage for the permanent "Weight" row (task: give the
// owner a door into WeightEntryScreen that isn't gated behind
// nextAction === 'weight'). Everything else this component renders
// (headline, macros, TDEE/trend) is unchanged and untested here; this
// file exists specifically to pin the new control's behaviour, not its
// pixels:
//   - it always renders, whatever `weightKg` is
//   - it reads a neutral (never "0 kg") invitation when nothing is
//     logged for the day being shown, and the actual figure otherwise
//   - tapping it fires `onLogWeight` — TodayScreen wires that to
//     `navigation.navigate('WeightEntry', { date: selectedDate })`, the
//     same call WeightPrompt already makes for its own date
// ═══════════════════════════════════════════════════════════════════════

import { act, create } from 'react-test-renderer';
import { StatusBlock } from '../StatusBlock';

const totals = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

function renderStatusBlock(weightKg: number | null, onLogWeight: () => void) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <StatusBlock totals={totals} targets={null} tdee={null} weightKg={weightKg} onLogWeight={onLogWeight} />
    );
  });
  return renderer;
}

/** Finds the row (the Pressable itself) carrying this exact accessibilityLabel. */
function findWeightRow(renderer: ReturnType<typeof create>, accessibilityLabel: string) {
  return renderer.root.findByProps({ accessibilityLabel });
}

describe('StatusBlock weight row', () => {
  test('renders even with no targets/TDEE yet (fresh install) — the door is not gated on engine state', () => {
    const renderer = renderStatusBlock(null, () => {});
    expect(() => findWeightRow(renderer, 'Weight not logged. Tap to log.')).not.toThrow();
  });

  test('shows a neutral invitation, never "0 kg", when nothing is logged for the selected day', () => {
    const renderer = renderStatusBlock(null, () => {});
    const tree = JSON.stringify(renderer.toJSON());
    expect(tree).toContain('Not logged');
    expect(tree).not.toContain('0 kg');
  });

  test('shows the logged reading for the selected day', () => {
    const renderer = renderStatusBlock(82.4, () => {});
    const tree = JSON.stringify(renderer.toJSON());
    expect(tree).toContain('82.4 kg');
  });

  test('tapping the row calls onLogWeight, regardless of whether a reading already exists', () => {
    const onLogWeightEmpty = jest.fn();
    const emptyRenderer = renderStatusBlock(null, onLogWeightEmpty);
    act(() => {
      findWeightRow(emptyRenderer, 'Weight not logged. Tap to log.').props.onPress();
    });
    expect(onLogWeightEmpty).toHaveBeenCalledTimes(1);

    const onLogWeightExisting = jest.fn();
    const existingRenderer = renderStatusBlock(82.4, onLogWeightExisting);
    act(() => {
      findWeightRow(existingRenderer, 'Weight 82.4 kg. Tap to update.').props.onPress();
    });
    expect(onLogWeightExisting).toHaveBeenCalledTimes(1);
  });
});
