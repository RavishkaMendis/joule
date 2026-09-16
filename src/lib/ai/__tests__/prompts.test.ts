// ═══════════════════════════════════════════════════════════════════════
// MEAL PHOTO PROMPT — typed dish annotation.
//
// Naming the dish is the highest-leverage context a user can give: a
// photo shows shapes and colours, not whether sushi is chicken or salmon,
// and never reveals the oil a stir-fry was cooked in — PRD §7.5's
// "single largest hidden variable in South Asian home cooking".
//
// The rule that must not slip (PRD §7.4): "The model identifies
// components; the user's stated quantities win." Naming a dish is an
// identity claim, NOT a quantity claim, so it must not licence the model
// to inflate confidence on portion sizes it still guessed visually.
// ═══════════════════════════════════════════════════════════════════════

import { buildLabelOcrPrompt, buildMealPhotoPrompt, buildPotIngredientsPrompt } from '../prompts';

describe('buildLabelOcrPrompt', () => {
  // The kJ trap (CLAUDE.md "domain traps", PRD §6) is the single most
  // likely correctness bug in this whole feature area — a future edit
  // must not be able to silently drop this instruction while reshaping
  // the prompt for something else (e.g. telling the model to ignore
  // background clutter around the panel).
  it('keeps the kJ-vs-kcal unit-handling instructions', () => {
    const prompt = buildLabelOcrPrompt();
    expect(prompt).toContain('energy_unit_detected');
    expect(prompt).toContain('kilojoules (kJ)');
    expect(prompt.toLowerCase()).toContain('kcal');
    expect(prompt).toContain("set energy_unit_detected to 'kJ' or 'kcal'");
  });

  it('tells the model the panel is the subject and to ignore surrounding clutter', () => {
    const prompt = buildLabelOcrPrompt();
    expect(prompt.toLowerCase()).toContain('ignore');
    expect(prompt).toContain('Nutrition Information Panel');
  });

  it('still asks for the per-100g column, not per-serving', () => {
    const prompt = buildLabelOcrPrompt();
    expect(prompt).toContain('PER-100g');
  });

  it('reminds the model to respond with JSON only', () => {
    const prompt = buildLabelOcrPrompt();
    expect(prompt).toContain('Respond with ONLY JSON');
  });
});

describe('buildMealPhotoPrompt with a typed note', () => {
  it('includes the note verbatim so the model sees the exact wording', () => {
    const prompt = buildMealPhotoPrompt(false, 'chicken sushi');
    expect(prompt).toContain('chicken sushi');
  });

  it('tells the model to decompose a named dish into realistic components', () => {
    const prompt = buildMealPhotoPrompt(false, 'fried rice');
    expect(prompt.toLowerCase()).toContain('components');
    // Invisible cooking fat is the whole point of asking (PRD §7.5).
    expect(prompt.toLowerCase()).toContain('cooking fat');
  });

  it('does NOT let naming a dish inflate quantity confidence', () => {
    const prompt = buildMealPhotoPrompt(false, 'chicken sushi');
    expect(prompt).toContain('NOT a quantity');
  });

  it('drops the "no annotation" line once a note is supplied', () => {
    const withNote = buildMealPhotoPrompt(false, 'fried rice');
    const without = buildMealPhotoPrompt(false);
    expect(without).toContain('No annotation was provided');
    expect(withNote).not.toContain('No annotation was provided');
  });

  it('treats whitespace-only notes as absent', () => {
    const blank = buildMealPhotoPrompt(false, '   ');
    expect(blank).toContain('No annotation was provided');
  });

  it('supports a typed note and a voice note together', () => {
    const prompt = buildMealPhotoPrompt(true, 'fried rice');
    expect(prompt).toContain('fried rice');
    expect(prompt).toContain('second audio clip');
    // The dish identity must be established before the audio instruction,
    // so the model knows what it is looking at while interpreting speech.
    expect(prompt.indexOf('fried rice')).toBeLessThan(prompt.indexOf('second audio clip'));
    expect(prompt).not.toContain('No annotation was provided');
  });

  it('still keeps visual-only estimates honest when there is no note', () => {
    const prompt = buildMealPhotoPrompt(false);
    expect(prompt).toContain('No annotation was provided');
    expect(prompt.toLowerCase()).toContain('low');
  });
});

describe('buildPotIngredientsPrompt', () => {
  it('demands RAW/pre-cook weight, not cooked weight (PRD §7.5 200% error trap)', () => {
    const prompt = buildPotIngredientsPrompt();
    expect(prompt).toContain('RAW');
    expect(prompt.toLowerCase()).toContain('pre-cook');
    expect(prompt).toContain('NEVER estimate what it would weigh after cooking');
  });

  it('tells the model NOT to guess cooking oil/ghee unless visibly measured', () => {
    const prompt = buildPotIngredientsPrompt();
    expect(prompt.toLowerCase()).toContain('cooking oil');
    expect(prompt.toLowerCase()).toContain('ghee');
    expect(prompt).toContain('Do NOT include a line item for cooking oil');
  });

  it('includes a typed note verbatim when supplied, and treats it as identity-only', () => {
    const prompt = buildPotIngredientsPrompt('chicken curry ingredients');
    expect(prompt).toContain('chicken curry ingredients');
  });

  it('has no note-related text when none is supplied', () => {
    const withNote = buildPotIngredientsPrompt('dal');
    const without = buildPotIngredientsPrompt();
    expect(withNote).not.toEqual(without);
    expect(without).not.toContain('typed this note');
  });

  it('treats whitespace-only notes as absent', () => {
    const blank = buildPotIngredientsPrompt('   ');
    const without = buildPotIngredientsPrompt();
    expect(blank).toEqual(without);
  });

  it('reminds the model to respond with JSON only, matching the shared schema', () => {
    const prompt = buildPotIngredientsPrompt();
    expect(prompt).toContain('Respond with ONLY JSON');
  });
});
