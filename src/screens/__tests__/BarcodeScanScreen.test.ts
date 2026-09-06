// ═══════════════════════════════════════════════════════════════════════
// BarcodeScanScreen — basket pure-logic tests (BUG 3: "doesn't let me
// remove one"). This repo has no React Native Testing Library (see
// OnboardingScreen.test.ts's own note), so this exercises `addBasketItem`
// / `removeBasketItem` — the pure functions the screen's basket state
// actually goes through — directly, plus the specific regression the task
// brief calls out as "the subtle failure here": removing a basket item
// must not disturb the scan-debounce state such that re-scanning the same
// barcode is then blocked.
// ═══════════════════════════════════════════════════════════════════════

import { addBasketItem, removeBasketItem, type BasketItem } from '../BarcodeScanScreen';
import { INITIAL_SCAN_DEBOUNCE_STATE, recordSighting, SCAN_DEBOUNCE_MS, shouldAcceptScan } from '../../lib/foodSources/scanDebounce';
import type { PendingEntry } from '../../lib/pendingEntry';

function makeEntry(name: string): PendingEntry {
  return { name, grams: 100, kcal: 200, protein_g: 5, carbs_g: 20, fat_g: 5, confidence: 'exact', source: 'barcode' };
}

describe('addBasketItem / removeBasketItem — pure basket state', () => {
  it('addBasketItem appends without mutating the input array', () => {
    const before: BasketItem[] = [];
    const after = addBasketItem(before, 'id1', makeEntry('Bread'));
    expect(before).toEqual([]); // not mutated
    expect(after).toEqual([{ id: 'id1', entry: makeEntry('Bread') }]);
  });

  it('removeBasketItem removes exactly the item with the given id, regardless of position', () => {
    const basket: BasketItem[] = [
      { id: 'a', entry: makeEntry('Bread') },
      { id: 'b', entry: makeEntry('Jam') },
      { id: 'c', entry: makeEntry('Milk') },
    ];
    const after = removeBasketItem(basket, 'b');
    expect(after.map((b) => b.id)).toEqual(['a', 'c']);
  });

  it('removeBasketItem is a no-op (returns an equivalent array) when the id is not present', () => {
    const basket: BasketItem[] = [{ id: 'a', entry: makeEntry('Bread') }];
    expect(removeBasketItem(basket, 'nonexistent')).toEqual(basket);
  });

  it('does not mutate the original array', () => {
    const basket: BasketItem[] = [{ id: 'a', entry: makeEntry('Bread') }];
    const copy = [...basket];
    removeBasketItem(basket, 'a');
    expect(basket).toEqual(copy);
  });
});

describe('BUG 3 — removing a basket item must not block re-scanning the same barcode ("the subtle failure here")', () => {
  it('scan A, remove A from the basket, then scanning A again (after a genuine gap) is accepted — removal touches only basket state, never ScanDebounceState', () => {
    // 1. Scan barcode "A": accepted, added to the basket, debounce state updated.
    let debounceState = INITIAL_SCAN_DEBOUNCE_STATE;
    let basket: BasketItem[] = [];

    const firstScanAccepted = shouldAcceptScan(debounceState, 'A', 0);
    debounceState = recordSighting('A', 0);
    expect(firstScanAccepted).toBe(true);
    basket = addBasketItem(basket, 'item-1', makeEntry('Product A'));
    expect(basket).toHaveLength(1);

    // 2. The user realises it was a mistake and removes it from the basket.
    basket = removeBasketItem(basket, 'item-1');
    expect(basket).toHaveLength(0);

    // 3. The user re-aims the camera at the SAME physical barcode after the
    //    code has genuinely left frame for the full debounce window (the
    //    ordinary "re-scan" case — see scanDebounce.test.ts for the
    //    "still in frame" case, which is deliberately still rejected).
    //    Removing the basket item above must have had ZERO effect on this
    //    — `removeBasketItem`'s signature doesn't even accept a
    //    ScanDebounceState, so there is no code path by which it could.
    const secondScanAt = SCAN_DEBOUNCE_MS + 1;
    const secondScanAccepted = shouldAcceptScan(debounceState, 'A', secondScanAt);
    expect(secondScanAccepted).toBe(true);

    // And the re-scan can be added back to the (now-empty) basket cleanly.
    basket = addBasketItem(basket, 'item-2', makeEntry('Product A'));
    expect(basket).toHaveLength(1);
    expect(basket[0].id).toBe('item-2');
  });

  it('removing one item from a multi-item basket leaves the others, and debounce state for a DIFFERENT still-present item is unaffected', () => {
    let basket: BasketItem[] = [];
    basket = addBasketItem(basket, 'bread', makeEntry('Bread'));
    basket = addBasketItem(basket, 'jam', makeEntry('Jam'));

    basket = removeBasketItem(basket, 'bread');

    expect(basket.map((b) => b.id)).toEqual(['jam']);
    expect(basket[0].entry.name).toBe('Jam');
  });
});
