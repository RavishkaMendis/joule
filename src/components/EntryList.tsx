// ═══════════════════════════════════════════════════════════════════════
// EntryList — today's logged items (PRD §9.1): tap to edit, swipe to
// delete, small source icon per row so exactness is visible at a glance.
//
// Meal grouping (schema v2): entries sharing a meal_group_id (e.g. the
// five rows a meal-photo capture produces) collapse into ONE row showing
// the meal name and total kcal, expandable to reveal its components.
// Ungrouped entries render exactly as every entry always has — a single
// row, no expand affordance, no visual change from before this feature
// existed.
//
// Editing/deleting: tapping a standalone entry (or an expanded
// component row) still calls `onEdit`/`onDelete` per-entry exactly as
// before. Deleting an unexpanded GROUP row calls `onDeleteGroup`, which
// TodayScreen wires to foodRepo.deleteGroup — that already triggers
// intakeRepo.recomputeDay for every affected date, so this component
// never calls it directly (same rule as before: no manual recompute
// here).
//
// Sectioning (this task): rows are bucketed into Breakfast / Lunch /
// Dinner / Snack / Unsorted via mealSections.ts's pure
// `groupEntriesBySection`, which sits ON TOP of the existing
// `groupEntriesByMeal` collapse above — a meal-photo group is still ONE
// row, now living in exactly one section. A section with nothing in it
// is simply not rendered: PRD §10 bans guilt/nagging, and an empty
// "Dinner" header sitting there at 9am reads as a checklist waiting to
// be completed even with zero styling applied to it — the safest way to
// guarantee it never nags is to not show it until it has something to
// say. Nothing is ever silently dropped this way: the same rule already
// governs the whole list (an empty DAY still renders the empty state
// below), and every entry always belongs to some section — Unsorted for
// null meal_type — so "no sections rendered" only ever means "no
// entries", never "entries got hidden".
//
// Reassigning meal type (task requirement — "everything editable
// forever" applies here too): long-press a row (standalone entry or a
// collapsed group's header) to open MealTypeSheet. This is deliberately
// NOT a tap — tap already means "edit" — and deliberately not on the
// logging fast path the 10-second test governs. Reassigning a GROUP
// moves every member together (via onChangeMealType's entryIds array),
// since a meal-photo capture is one row and must stay in one section.
// ═══════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { colors, numeric, radii, spacing, type } from '../lib/theme';
import type { FoodEntryRow, MealType } from '../db/types';
import { type MealGroup } from '../lib/mealGrouping';
import { groupEntriesBySection, type MealSection } from '../lib/mealSections';
import { SourceIcon } from './SourceIcon';
import { MealTypeSheet } from './MealTypeSheet';

type Props = {
  entries: FoodEntryRow[];
  onEdit: (entry: FoodEntryRow) => void;
  onDelete: (entry: FoodEntryRow) => void;
  /** Deletes every entry in a meal group at once (the collapsed row's swipe-to-delete action). */
  onDeleteGroup: (mealGroupId: string) => void;
  /** Reassigns meal_type for every id in `entryIds` at once — a single entry (standalone row) or every member of a collapsed group (whole-row reassignment, see file header). */
  onChangeMealType: (entryIds: string[], mealType: MealType) => void;
  /** Whether QuickAddChips is currently rendering any chips above this list — changes the empty-state copy so it never references a chip row that isn't there yet (e.g. a brand-new install with no saved foods). */
  hasQuickAdd?: boolean;
};

/** What MealTypeSheet is currently open for — cleared once a selection is made or the sheet is dismissed. */
type SheetTarget = {
  entryIds: string[];
  subjectLabel: string;
  currentMealType: MealType | null;
};

export function EntryList({ entries, onEdit, onDelete, onDeleteGroup, onChangeMealType, hasQuickAdd = false }: Props) {
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null);

  if (entries.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Nothing logged yet today.</Text>
        <Text style={styles.emptySubtext}>
          {hasQuickAdd ? 'Use a quick-add chip above, or tap + to log your first meal.' : 'Tap + to log your first meal.'}
        </Text>
      </View>
    );
  }

  const sections = groupEntriesBySection(entries);

  return (
    <View style={styles.container}>
      {sections.map((section) => (
        <SectionBlock
          key={section.mealType ?? 'unsorted'}
          section={section}
          onEdit={onEdit}
          onDelete={onDelete}
          onDeleteGroup={onDeleteGroup}
          onRequestReassign={setSheetTarget}
        />
      ))}

      <MealTypeSheet
        visible={sheetTarget !== null}
        subjectLabel={sheetTarget?.subjectLabel ?? ''}
        currentMealType={sheetTarget?.currentMealType ?? null}
        onSelect={(mealType) => {
          if (sheetTarget) onChangeMealType(sheetTarget.entryIds, mealType);
          setSheetTarget(null);
        }}
        onClose={() => setSheetTarget(null)}
      />
    </View>
  );
}

function SectionBlock({
  section,
  onEdit,
  onDelete,
  onDeleteGroup,
  onRequestReassign,
}: {
  section: MealSection;
  onEdit: (entry: FoodEntryRow) => void;
  onDelete: (entry: FoodEntryRow) => void;
  onDeleteGroup: (mealGroupId: string) => void;
  onRequestReassign: (target: SheetTarget) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{section.label}</Text>
        <Text style={styles.sectionKcal}>{Math.round(section.totals.kcal)}</Text>
      </View>

      {section.groups.map((group) =>
        group.mealGroupId === null ? (
          <StandaloneRow
            key={group.key}
            entry={group.members[0]}
            onEdit={onEdit}
            onDelete={onDelete}
            onLongPress={() =>
              onRequestReassign({
                entryIds: [group.members[0].id],
                subjectLabel: group.members[0].name,
                currentMealType: group.members[0].meal_type,
              })
            }
          />
        ) : (
          <GroupedRow
            key={group.key}
            group={group}
            onEdit={onEdit}
            onDeleteGroup={() => onDeleteGroup(group.mealGroupId as string)}
            onLongPress={() =>
              onRequestReassign({
                entryIds: group.members.map((m) => m.id),
                subjectLabel: group.displayName,
                currentMealType: group.members[0].meal_type,
              })
            }
          />
        )
      )}
    </View>
  );
}

function StandaloneRow({
  entry,
  onEdit,
  onDelete,
  onLongPress,
}: {
  entry: FoodEntryRow;
  onEdit: (entry: FoodEntryRow) => void;
  onDelete: (entry: FoodEntryRow) => void;
  /** Opens MealTypeSheet for this entry — never fires alongside onPress (RN treats tap vs. long-press as mutually exclusive gestures). */
  onLongPress: () => void;
}) {
  return (
    <Swipeable
      renderRightActions={() => (
        <Pressable
          onPress={() => onDelete(entry)}
          style={styles.deleteAction}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${entry.name}`}
        >
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      )}
    >
      <Pressable
        onPress={() => onEdit(entry)}
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityHint="Long press to change meal"
      >
        <SourceIcon source={entry.source} confidence={entry.confidence} />
        <View style={styles.rowMiddle}>
          <Text style={styles.rowName} numberOfLines={1}>
            {entry.name}
          </Text>
          <Text style={styles.rowMacros}>
            {Math.round(entry.grams)}g · P{Math.round(entry.protein_g)} C{Math.round(entry.carbs_g)} F
            {Math.round(entry.fat_g)}
          </Text>
        </View>
        <Text style={styles.rowKcal}>{Math.round(entry.kcal)}</Text>
      </Pressable>
    </Swipeable>
  );
}

function GroupedRow({
  group,
  onEdit,
  onDeleteGroup,
  onLongPress,
}: {
  group: MealGroup;
  onEdit: (entry: FoodEntryRow) => void;
  onDeleteGroup: () => void;
  /** Opens MealTypeSheet for the WHOLE group — reassigns every member together, since the group renders as one row and must stay in one section. */
  onLongPress: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View>
      <Swipeable
        renderRightActions={() => (
          <Pressable
            onPress={onDeleteGroup}
            style={styles.deleteAction}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${group.displayName} (${group.members.length} items)`}
          >
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        )}
      >
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          onLongPress={onLongPress}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={`${group.displayName}, ${Math.round(group.totals.kcal)} calories, ${group.members.length} items, ${expanded ? 'expanded' : 'collapsed'}`}
          accessibilityHint="Long press to change meal"
        >
          <View style={styles.groupIconStack}>
            <Text style={styles.groupChevron}>{expanded ? '⌄' : '›'}</Text>
          </View>
          <View style={styles.rowMiddle}>
            <Text style={styles.rowName} numberOfLines={1}>
              {group.displayName}
            </Text>
            <Text style={styles.rowMacros}>
              {group.members.length} items · P{Math.round(group.totals.protein_g)} C{Math.round(group.totals.carbs_g)} F
              {Math.round(group.totals.fat_g)}
            </Text>
          </View>
          <Text style={styles.rowKcal}>{Math.round(group.totals.kcal)}</Text>
        </Pressable>
      </Swipeable>

      {expanded && (
        <View style={styles.componentsContainer}>
          {group.members.map((member) => (
            <Pressable
              key={member.id}
              onPress={() => onEdit(member)}
              style={({ pressed }) => [styles.componentRow, pressed && styles.rowPressed]}
              accessibilityRole="button"
            >
              <SourceIcon source={member.source} confidence={member.confidence} />
              <View style={styles.rowMiddle}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {member.name}
                </Text>
                <Text style={styles.rowMacros}>
                  {Math.round(member.grams)}g · P{Math.round(member.protein_g)} C{Math.round(member.carbs_g)} F
                  {Math.round(member.fat_g)}
                </Text>
              </View>
              <Text style={styles.rowKcalSmall}>{Math.round(member.kcal)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
  },
  // Sections read as quiet grouping, not a checklist — same neutral tone
  // whether the subtotal is over or under any target (PRD §10: no red,
  // no guilt). A section only renders once it has a group in it (see
  // mealSections.ts), so there is never an empty header to word this
  // defensively for.
  section: {
    marginBottom: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: spacing.xs,
  },
  sectionTitle: {
    ...type.sectionLabel,
    color: colors.textTertiary,
  },
  sectionKcal: {
    ...type.caption,
    ...numeric,
    color: colors.textTertiary,
  },
  emptyContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  emptyText: {
    ...type.body,
    color: colors.textTertiary,
  },
  emptySubtext: {
    ...type.caption,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  rowMiddle: {
    flex: 1,
  },
  rowName: {
    ...type.body,
    color: colors.text,
  },
  rowMacros: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
    marginTop: 2,
  },
  rowKcal: {
    ...type.bodyStrong,
    ...numeric,
    color: colors.text,
  },
  rowKcalSmall: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  deleteAction: {
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
  },
  deleteText: {
    ...type.body,
    color: colors.text,
  },
  groupIconStack: {
    alignItems: 'center',
    minWidth: 28,
  },
  groupChevron: {
    ...type.bodyStrong,
    color: colors.textTertiary,
  },
  componentsContainer: {
    paddingLeft: spacing.lg,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    marginLeft: 13,
  },
  componentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingLeft: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
});
