// ═══════════════════════════════════════════════════════════════════════
// MEAL NAME SUGGESTION — for a multi-item capture (meal photo/voice), the
// user gets to name the group ("Chicken Sushi") rather than seeing five
// separate rows explode onto Today.
//
// Threading choice (see task report): the typed dish note
// (MealPhotoScreen's `textNote`) is the obvious source of a suggestion,
// but MealPhotoScreen/LabelScanScreen/BarcodeScanScreen are owned by a
// concurrent agent and out of scope to edit here, so `textNote` cannot be
// threaded into ConfirmSheetProps without touching that file. Instead,
// this module derives a suggestion purely from the confirmed item list
// ConfirmSheet already has — self-contained within this task's owned
// files. If `textNote` threading is added later (an additive optional
// prop on ConfirmSheetProps, populated by the AI screens), it should take
// priority over this derived suggestion, not replace this module: keep
// this as the fallback for voice/barcode/other multi-item paths that may
// never carry a typed note.
// ═══════════════════════════════════════════════════════════════════════

import type { PendingEntry } from './pendingEntry';

/** Longest common sense of "the main component" — the item with the highest kcal, ties broken by first-listed. */
function largestItem(entries: PendingEntry[]): PendingEntry {
  return entries.reduce((best, e) => (e.kcal > best.kcal ? e : best), entries[0]);
}

/** Title-cases a food name for display ("sushi rice" -> "Sushi Rice"). Leaves existing capitalization on short/acronym-like words alone. */
function titleCase(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((word) => (word.length <= 3 && word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/**
 * Derives a sensible meal-name suggestion from a multi-item capture.
 * Never called for a single-item capture — the caller (ConfirmSheet) only
 * offers meal naming at 2+ items in the first place (PRD §9.1's 10-second
 * test: a single scan/manual entry must not demand a meal name).
 *
 * Strategy: name it after the largest (highest-kcal) component, since
 * that is usually the dish's identity ("Chicken" in a chicken-rice-veg
 * photo) — a plain join of every item name ("Sushi Rice, Chicken Filling,
 * Avocado, Nori, Spicy Mayo") is technically accurate but unreadable as a
 * row title, and defeats the point of collapsing the row in the first
 * place.
 */
export function suggestMealName(entries: PendingEntry[]): string {
  if (entries.length === 0) return '';
  if (entries.length === 1) return titleCase(entries[0].name);

  const main = largestItem(entries);
  return titleCase(main.name);
}
