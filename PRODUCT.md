# Joule — product context

**Register: product.** Design serves the task. This is a tool used daily, often one-handed, often in a kitchen. It should disappear into logging food and get out of the way.

> Full spec lives in [PRD-macro-tracker.md](PRD-macro-tracker.md); engineering constraints in [CLAUDE.md](CLAUDE.md). This file is the design-facing summary — do not duplicate those, read them.

## What it is

A personal adaptive-TDEE nutrition tracker for two people (Rav and his partner). It measures true energy expenditure from logged intake versus smoothed bodyweight trend and adjusts calorie targets weekly. **Food logging exists to feed that engine** — it is a means, not the product.

Built to escape a MacroFactor subscription. Android (Rav) and iOS via TestFlight (partner). Data is local-first SQLite; no accounts, no cloud sync.

## Who uses it, where

Morning: half-awake, stepping off a scale, logging one number. Evening: standing over a pot of dal, phone in one hand, wanting to be done in ten seconds. Occasionally sitting down to look at trends and understand why the number moved.

Dark theme is not a style choice — it's a 6am bedroom and a dim kitchen.

## Design rules that are algorithmic, not aesthetic

These come from PRD §10 and exist for engine-integrity reasons, not taste. They are not negotiable in a polish pass:

- **No streaks, no guilt, no red.** A missed day is data-neutral to the algorithm. If the UI implies otherwise, the user logs dishonestly to protect a number — which poisons the TDEE engine the whole app exists to run. Over-target renders in the same neutral tone as under-target.
- **Confidence always visible.** A ±25–40% photo estimate must never look identical to a barcode scan.
- **TDEE is always a range, never a bare number.** The visibly narrowing band is what earns trust in the estimate.
- **Unlogged days are gaps, never zeros.** A zero implies a fast that never happened.
- **Everything editable forever**, including past days.

## The governing constraint

> **The 10-second test (PRD §9.1):** if logging a repeat meal takes longer than ten seconds, the user stops within a fortnight and the engine starves.

Every interaction decision on the Today screen and the confirmation sheet defers to this. Polish that adds a tap is a regression, however good it looks.

## Visual system

Dark, system typography, minimal styling — function over polish, stated explicitly in PRD §10. Tokens live in `src/lib/theme.ts` (`colors`, `spacing`, `radii`, `type`, `minTouchTarget`). One accent (blue) for primary actions and current selection only. A confidence ladder expressed as opacity, never as a red/amber/green trust scale.

Protein is listed first in every macro display — it's the macro that matters and the one most often missed.
