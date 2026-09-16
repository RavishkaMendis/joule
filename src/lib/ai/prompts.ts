// ═══════════════════════════════════════════════════════════════════════
// PROMPT TEXT — one builder per input path.
//
// Every prompt below explicitly asks for `energy_unit_detected` and
// warns about kJ, because PRD §6 is emphatic that Australian panels
// default to kJ and silently misreading it as kcal is the single most
// likely correctness bug in this whole feature area.
// ═══════════════════════════════════════════════════════════════════════

const JSON_ONLY_REMINDER =
  'Respond with ONLY JSON matching the schema. No markdown code fences, no commentary before or after.';

export function buildLabelOcrPrompt(): string {
  return [
    'You are reading a photo of an Australian (or NZ) packaged-food Nutrition Information Panel.',
    'The Nutrition Information Panel itself is the subject of this photo. The frame may also contain background clutter around it — a hand, a table, other packaging, curved or angled edges of the label — that is not part of the panel. Ignore all of that surrounding content entirely and read only the panel\'s own printed table.',
    'Read the PER-100g (or per-100mL) column, not the per-serving column.',
    "CRITICAL: Australian panels usually list energy in kilojoules (kJ), not kilocalories (kcal). Read the unit label on the panel exactly as printed and set energy_unit_detected to 'kJ' or 'kcal' accordingly. Report kcal_per_100g using WHATEVER unit you detected — do not convert it yourself, the app converts kJ to kcal downstream. If both kJ and kcal are printed, prefer kJ as the detected unit (it's the primary AU/NZ figure) and report that kJ number.",
    'Set grams to 100 unless the photo shows a different reference amount was used for this reading.',
    "Return exactly one item in the items array for this product. Use the product name if visible, otherwise a short generic description.",
    "Set confidence to 'exact' if the panel is clearly legible, 'high' if mostly legible with minor guesswork, 'medium' if partially obscured/blurry, 'low' if you are largely guessing.",
    'In assumptions, state anything you had to assume (e.g. "per-serving column used because per-100g was cropped out", "energy given only in kJ, converted flag left to app").',
    JSON_ONLY_REMINDER,
  ].join('\n');
}

/**
 * @param hasVoiceNote Whether a second audio part (the user's spoken
 * annotation) is attached alongside the photo in this same request. There
 * is no transcript — Gemini listens to the raw audio directly (PRD §7.1
 * skips speech-to-text entirely), so the prompt just needs to tell it
 * that a second, spoken input exists and how to weight it.
 */
export function buildMealPhotoPrompt(hasVoiceNote: boolean, textNote?: string): string {
  const lines = [
    'You are looking at a photo of a plate of food. Identify each distinct component (protein, carb, vegetable, sauce, oil, etc.) as a separate item.',
    'For each item, estimate grams consumed and its per-100g macros (protein/carbs/fat in grams, energy in kcal_per_100g — assume kcal for your own visual estimate unless you are quoting a label visible in the photo, in which case follow the same kJ/kcal detection rule as a nutrition panel).',
    'Unannotated visual portion estimates are inherently rough — set confidence to "low" for any item where you had no stated quantity to go on, "medium" at best for a confident visual estimate. Do not mark visual-only estimates as "high" or "exact".',
    'State your grams/portion assumptions explicitly in "assumptions" for every item (e.g. "assumed 1 tbsp oil ≈ 14g", "assumed medium chicken breast ≈ 150g") — this is shown to the user to build trust and catch errors.',
  ];

  // A typed note is the fastest way to give the model context it cannot
  // see: a dish's identity ("chicken sushi", "fried rice") pins down which
  // ingredients are plausible, and named-but-invisible additions (oil,
  // ghee, sugar) are the largest hidden variable in home cooking per PRD
  // §7.5. Placed BEFORE the voice-note instruction so that when both are
  // present the model has already been told what the dish is.
  const note = textNote?.trim();
  if (note) {
    lines.push(
      `The user typed this note about the meal: "${note}".` +
        ' Treat it as authoritative about WHAT the food is — it identifies the dish and may name ingredients or cooking methods you cannot see (oil, ghee, butter, sugar, sauces). Use it to decide which components exist and what they are made of, rather than guessing purely from appearance.' +
        ' If the note names a dish (e.g. "chicken sushi", "fried rice"), break it into its realistic components with the macros typical of that dish, including cooking fat that is invisible in a photo but certainly present.' +
        ' If the note states a quantity for an item, that stated quantity WINS over your visual estimate for that item, and you may set its confidence to "high".' +
        ' Naming a dish is NOT a quantity — items identified but not quantified stay at your honest visual-estimate confidence ("low", or "medium" at best).'
    );
  }

  if (hasVoiceNote) {
    lines.push(
      'A second audio clip is attached: the user speaking about this same meal, describing quantities for some or all of what is on the plate (e.g. "about 150 grams of chicken, a tablespoon of oil"). Listen to it and, for any item where the user states a quantity, use THEIR stated quantity for that item\'s grams instead of your own visual guess — the user\'s stated quantities always win over your visual estimate. You may raise confidence to "high" for that specific item since it is no longer a pure visual estimate. If the user names an item not clearly visible in the photo, include it anyway. For any item the user did NOT mention a quantity for, keep your visual estimate and its honest (typically "low") confidence.'
    );
  } else if (!note) {
    lines.push('No annotation was provided — every item is a visual-only estimate; keep confidence honest (mostly "low").');
  }

  lines.push(JSON_ONLY_REMINDER);
  return lines.join('\n');
}

/**
 * Pot ingredients photo (PRD §7.5, task brief "meal-prep workflow"):
 * photo of the RAW ingredients laid out before cooking a batch (rice,
 * lentils, chicken, spices…), identified into an editable ingredient
 * list the user turns into a pot. Reuses the exact same
 * GeminiStructuredResponse/GeminiFoodItem shape (schema.ts) as every
 * other AI path — `grams` here means RAW, PRE-COOK weight (the ⚠️ trap
 * PRD §7.5 calls out: "100g raw basmati ≈ 300g cooked, a 200% error"),
 * never the finished dish's serving weight.
 *
 * Cooking oil/ghee (PRD §7.5: "the single largest hidden variable in
 * South Asian home cooking… no vision model will ever see") is
 * explicitly called out as something this prompt must NOT guess at
 * unless it is visibly measured in the photo — the app separately makes
 * adding it a one-tap action in PotCreateScreen (the same oil/ghee
 * presets ConfirmSheet already offers), which is the honest way to
 * capture it rather than inventing a plausible-looking number here.
 */
export function buildPotIngredientsPrompt(textNote?: string): string {
  const lines = [
    'You are looking at a photo of RAW, UNCOOKED ingredients laid out before cooking a batch meal (e.g. home-style South Asian/Sri Lankan cooking: rice, lentils, chicken, vegetables, spices, coconut milk, etc.), NOT a photo of a finished cooked plate.',
    'Identify each distinct visible ingredient as a separate item.',
    'CRITICAL: report `grams` as the RAW, PRE-COOK weight of that ingredient as it appears in the photo (e.g. dry uncooked rice, raw chicken) — NEVER estimate what it would weigh after cooking. 100g of raw rice becomes roughly 300g cooked; reporting a cooked-weight guess here would be a ~200% error once this ingredient is used to compute the batch\'s calories per gram.',
    'For each item, report per-100g macros for that ingredient in its RAW/as-purchased form (protein/carbs/fat in grams, energy in kcal_per_100g — assume kcal for your own estimate unless you are quoting a label visible in the photo, e.g. a rice/lentil packet, in which case follow the same kJ/kcal detection rule as a nutrition panel and set energy_unit_detected accordingly).',
    'Do NOT include a line item for cooking oil, ghee, or butter unless you can actually SEE a measured quantity of it in the photo (e.g. a filled measuring spoon or a marked oil bottle) — oil poured into a pan during cooking is invisible to a photo of raw ingredients, and guessing an amount here would fabricate a number the user has not actually confirmed. Leave it out entirely rather than guess; the app separately prompts the user to add cooking oil/ghee as its own step.',
    'Confidence should usually be "low" or "medium" for a purely visual quantity estimate of a raw ingredient (raw rice/lentils/spices in a bowl are hard to judge by eye) — reserve "high"/"exact" only for a quantity or per-100g figure you are reading directly off a visible packet/label, not a visual guess of a loose ingredient.',
    'State your quantity/identification assumptions explicitly in "assumptions" for every item (e.g. "estimated ~200g raw rice by bowl fill level", "read per-100g figures off the visible lentil packet") — this is shown to the user to build trust and catch errors, and lets them correct the raw grams before saving.',
  ];

  const note = textNote?.trim();
  if (note) {
    lines.push(
      `The user typed this note about what they are cooking: "${note}".` +
        ' Treat it as authoritative about WHAT the dish/ingredients are and use it to identify items you can see more precisely (e.g. "chicken curry" tells you an ambiguous raw protein is chicken, not lamb) — it does NOT excuse you from estimating raw grams visually for anything not directly quoted with a quantity in the note itself.'
    );
  }

  lines.push(JSON_ONLY_REMINDER);
  return lines.join('\n');
}
