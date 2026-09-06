// ═══════════════════════════════════════════════════════════════════════
// ID GENERATION
//
// Every repo in src/db/repositories expects a caller-supplied TEXT primary
// key (food_entry.id, saved_food.id, pot.id) rather than autoincrement.
// `expo-crypto`'s randomUUID isn't installed and pulling in a new native
// module for this is unwarranted — a timestamp + random suffix is unique
// enough for a single-device, single-user offline app and needs zero new
// dependencies.
// ═══════════════════════════════════════════════════════════════════════

let counter = 0;

/** A locally-unique id: sortable-ish (timestamp prefix) + collision-proof within a session. */
export function generateId(prefix = 'id'): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${rand}`;
}
