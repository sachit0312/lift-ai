import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { useAnimatedStyle, SharedValue, interpolate, Extrapolation } from 'react-native-reanimated';
import type { LocalSet, ExerciseBlock } from '../types/workout';
import type { Exercise, UpcomingWorkoutExercise, UpcomingWorkoutSet } from '../types/database';
import { getSetTagLabel, getSetTagColor } from '../utils/setTagUtils';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout } from '../theme';

// Pre-allocated style/hitSlop objects to avoid re-creation in render loops
const HIT_SLOP_8 = { top: 8, bottom: 8, left: 8, right: 8 };
const HIT_SLOP_4 = { top: 4, bottom: 4, left: 4, right: 4 };
const CHECK_COL_STYLE = { position: 'relative' as const };

// ─── SwipeableSetRow helpers ───

interface SwipeableSetRowProps {
  set: LocalSet;
  setIdx: number;
  blockIdx: number;
  block: ExerciseBlock;
  onDelete: (blockIdx: number, setIdx: number) => void;
  children: React.ReactNode;
}

// Swipe-to-delete: red expands with swipe, trash icon fades in as you swipe further
const SetRightAction = React.memo(function SetRightAction({ drag }: { drag: SharedValue<number> }) {
  const animatedStyle = useAnimatedStyle(() => {
    const dragVal = typeof drag?.value === 'number' ? -drag.value : 0;
    return {
      width: Math.max(80, dragVal),
    };
  });

  const iconStyle = useAnimatedStyle(() => {
    const dragVal = typeof drag?.value === 'number' ? -drag.value : 0;
    const opacity = interpolate(dragVal, [0, 60, 100], [0, 0.6, 1], Extrapolation.CLAMP);
    const scale = interpolate(dragVal, [0, 60, 100], [0.5, 0.85, 1], Extrapolation.CLAMP);
    return { opacity, transform: [{ scale }] };
  });

  return (
    <Animated.View style={[styles.swipeDeleteContainer, animatedStyle]}>
      <Animated.View style={[styles.swipeDeleteContent, iconStyle]}>
        <Ionicons name="trash" size={20} color={colors.white} />
        <Text style={styles.swipeDeleteLabel}>Delete</Text>
      </Animated.View>
    </Animated.View>
  );
});

const SwipeableSetRow = React.memo(function SwipeableSetRow({
  setIdx,
  blockIdx,
  block,
  onDelete,
  children,
}: SwipeableSetRowProps) {
  const canDelete = block.sets.length > 1;

  const renderRightActions = useCallback(
    (_progress: SharedValue<number>, drag: SharedValue<number>) => {
      if (!canDelete) return null;
      return <SetRightAction drag={drag} />;
    },
    [canDelete]
  );

  const handleSwipeableWillOpen = useCallback(
    (direction: 'left' | 'right') => {
      if (direction === 'left' && canDelete) {
        onDelete(blockIdx, setIdx);
      }
    },
    [canDelete, blockIdx, setIdx, onDelete]
  );

  if (!canDelete) {
    return (
      <View testID={`swipeable-set-${blockIdx}-${setIdx}`}>
        {children}
      </View>
    );
  }

  return (
    <ReanimatedSwipeable
      renderRightActions={renderRightActions}
      onSwipeableWillOpen={handleSwipeableWillOpen}
      rightThreshold={120}
      overshootRight={false}
      testID={`swipeable-set-${blockIdx}-${setIdx}`}
    >
      {children}
    </ReanimatedSwipeable>
  );
});

// ─── ExerciseBlockItem (memoized) ───

export interface ExerciseBlockItemProps {
  block: ExerciseBlock;
  blockIdx: number;
  upcomingTargets: (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] | null;
  blockErrorKey: string;
  isPRSet: (setId: string) => boolean;
  onToggleRestTimer: (blockIdx: number) => void;
  onAdjustRest: (blockIdx: number, delta: number) => void;
  onCycleTag: (blockIdx: number, setIdx: number) => void;
  onDeleteSet: (blockIdx: number, setIdx: number) => void;
  onSetChange: (blockIdx: number, setIdx: number, field: 'weight' | 'reps' | 'rpe', value: string) => void;
  onToggleComplete: (blockIdx: number, setIdx: number) => void;
  onAddSet: (blockIdx: number) => void;
  onToggleNotes: (blockIdx: number) => void;
  onRemoveExercise: (blockIdx: number) => void;
  onNotesChange: (blockIdx: number, text: string) => void;
  onExercisePress: (exercise: Exercise) => void;
}

const ExerciseBlockItem = React.memo(function ExerciseBlockItem({
  block,
  blockIdx,
  upcomingTargets,
  blockErrorKey,
  isPRSet,
  onToggleRestTimer,
  onAdjustRest,
  onCycleTag,
  onDeleteSet,
  onSetChange,
  onToggleComplete,
  onAddSet,
  onToggleNotes,
  onRemoveExercise,
  onNotesChange,
  onExercisePress,
}: ExerciseBlockItemProps) {
  const coachTip = upcomingTargets?.find(e => e.exercise_id === block.exercise.id)?.notes;

  // Pre-compute per-block error set for O(1) lookup per set row
  const errorSet = useMemo(() => {
    if (!blockErrorKey) return null;
    const s = new Set<string>();
    for (const k of blockErrorKey.split(',')) s.add(k);
    return s;
  }, [blockErrorKey]);

  // Pre-compute upcomingTargets lookup: Map<set_number, target> for O(1) per set
  const targetMap = useMemo(() => {
    const upEx = upcomingTargets?.find(e => e.exercise_id === block.exercise.id);
    if (!upEx?.sets?.length) return null;
    const m = new Map<number, (typeof upEx.sets)[number]>();
    for (const s of upEx.sets) m.set(s.set_number, s);
    return m;
  }, [upcomingTargets, block.exercise.id]);
  const [coachTipExpanded, setCoachTipExpanded] = React.useState(false);

  return (
    <View style={styles.exerciseCard}>
      {/* Exercise header with name */}
      <View style={styles.exerciseHeaderRow}>
        <TouchableOpacity onPress={() => onExercisePress(block.exercise)} style={styles.exerciseNameContainer}>
          <Text style={styles.exerciseName}>{block.exercise.name}</Text>
        </TouchableOpacity>
      </View>

      {/* Coach tip from upcoming workout */}
      {coachTip ? (
        <TouchableOpacity
          style={styles.coachTipRow}
          onPress={() => setCoachTipExpanded(prev => !prev)}
          activeOpacity={0.7}
        >
          <Ionicons name="sparkles" size={14} color={colors.primary} />
          <Text style={styles.coachTipLabel}>Coach tip</Text>
          <Ionicons
            name={coachTipExpanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.primary}
          />
        </TouchableOpacity>
      ) : null}
      {coachTip && coachTipExpanded ? (
        <View style={styles.coachTipContent}>
          <Text style={styles.coachTipText}>{coachTip}</Text>
        </View>
      ) : null}

      {/* Set header row */}
      <View style={styles.setHeaderRow}>
        <Text style={[styles.setHeaderCell, styles.setNumCol]}>SET</Text>
        <Text style={[styles.setHeaderCell, styles.colFlex]}>LBS</Text>
        <Text style={[styles.setHeaderCell, styles.colFlex]}>REPS</Text>
        <Text style={[styles.setHeaderCell, styles.colRpe]}>RPE</Text>
        <Text style={[styles.setHeaderCell, styles.checkCol]} />
      </View>

      {/* Set rows */}
      {block.sets.map((set, setIdx) => {
        const tagLabel = getSetTagLabel(set.tag);
        const tagColor = getSetTagColor(set.tag);
        const hasError = errorSet?.has(`${blockIdx}-${setIdx}`) ?? false;
        const target = targetMap?.get(set.set_number);
        const weightPlaceholder = target ? String(target.target_weight) : (set.previous ? String(set.previous.weight) : '');
        const repsPlaceholder = target ? String(target.target_reps) : (set.previous ? String(set.previous.reps) : '');
        const placeholderColor = target ? colors.primaryPlaceholder : 'rgba(107, 107, 114, 0.5)';
        return (
          <SwipeableSetRow
            key={set.id}
            set={set}
            setIdx={setIdx}
            blockIdx={blockIdx}
            block={block}
            onDelete={onDeleteSet}
          >
            <View
              style={[
                styles.setRow,
                set.is_completed && styles.setRowCompleted,
                !set.is_completed && set.tag === 'warmup' && styles.setRowWarmup,
              ]}
            >
              <TouchableOpacity
                style={styles.setNumCol}
                onPress={() => onCycleTag(blockIdx, setIdx)}
                onLongPress={() => onDeleteSet(blockIdx, setIdx)}
                hitSlop={HIT_SLOP_8}
                testID={`set-tag-${blockIdx}-${setIdx}`}
              >
                {tagLabel ? (
                  <View style={[styles.setNumBadge, { backgroundColor: tagColor }]}>
                    <Text style={styles.setNumBadgeText}>{tagLabel}</Text>
                  </View>
                ) : (
                  <Text style={styles.setNum}>
                    {set.set_number}
                  </Text>
                )}
              </TouchableOpacity>
              <TextInput
                style={[styles.setInput, styles.colFlex, hasError && styles.setInputError]}
                keyboardType="numeric"
                value={set.weight}
                onChangeText={(v) => onSetChange(blockIdx, setIdx, 'weight', v)}
                placeholder={weightPlaceholder}
                placeholderTextColor={placeholderColor}
                testID={`weight-${blockIdx}-${setIdx}`}
              />
              <TextInput
                style={[styles.setInput, styles.colFlex, hasError && styles.setInputError]}
                keyboardType="numeric"
                value={set.reps}
                onChangeText={(v) => onSetChange(blockIdx, setIdx, 'reps', v)}
                placeholder={repsPlaceholder}
                placeholderTextColor={placeholderColor}
                testID={`reps-${blockIdx}-${setIdx}`}
              />
              {(set.tag === 'warmup' || set.tag === 'failure') ? (
                <View style={[styles.colRpe]} testID={`rpe-${blockIdx}-${setIdx}`} />
              ) : (
                <TextInput
                  style={[styles.setInput, styles.colRpe]}
                  keyboardType="numeric"
                  value={set.rpe}
                  onChangeText={(v) => onSetChange(blockIdx, setIdx, 'rpe', v)}
                  placeholder={target?.target_rpe ? String(target.target_rpe) : '—'}
                  placeholderTextColor={target?.target_rpe ? colors.primaryPlaceholder : colors.textMuted}
                  testID={`rpe-${blockIdx}-${setIdx}`}
                />
              )}
              <View style={[styles.checkCol, CHECK_COL_STYLE]}>
                <TouchableOpacity
                  style={[styles.checkBox, set.is_completed && styles.checkBoxDone]}
                  onPress={() => onToggleComplete(blockIdx, setIdx)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: set.is_completed }}
                  testID={`check-${blockIdx}-${setIdx}`}
                >
                  {set.is_completed && (
                    <Ionicons name="checkmark" size={18} color={colors.white} />
                  )}
                </TouchableOpacity>
                {isPRSet(set.id) && (
                  <View style={styles.prBadge}>
                    <Text style={styles.prBadgeText}>PR</Text>
                  </View>
                )}
              </View>
            </View>
          </SwipeableSetRow>
        );
      })}

      {/* Add set + notes + remove */}
      <View style={styles.exerciseActions}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onAddSet(blockIdx)}>
          <Ionicons name="add" size={16} color={colors.primary} />
          <Text style={styles.actionBtnText}>Add Set</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onToggleNotes(blockIdx)}>
          <Ionicons name={block.notesExpanded ? 'document-text' : 'document-text-outline'} size={16} color={colors.textMuted} />
          <Text style={styles.actionBtnTextMuted}>
            {block.notesExpanded ? 'Hide Notes' : 'Notes'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.removeExerciseBtn}
          onPress={() => onRemoveExercise(blockIdx)}
          testID={`remove-exercise-${blockIdx}`}
        >
          <Ionicons name="close" size={18} color={colors.error} />
        </TouchableOpacity>
      </View>

      {/* Rest timer controls */}
      <View style={styles.restTimerRow}>
        <TouchableOpacity
          style={styles.headerRestBtn}
          onPress={() => onAdjustRest(blockIdx, -15)}
          hitSlop={HIT_SLOP_8}
        >
          <Text style={styles.headerRestBtnText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onToggleRestTimer(blockIdx)}
          testID={`rest-timer-toggle-${blockIdx}`}
          hitSlop={HIT_SLOP_4}
        >
          <Text style={[styles.headerRestDisplay, !block.restEnabled && styles.headerRestDisplayOff]}>
            {block.restEnabled
              ? `${Math.floor(block.restSeconds / 60)}:${String(block.restSeconds % 60).padStart(2, '0')}`
              : 'Off'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerRestBtn}
          onPress={() => onAdjustRest(blockIdx, 15)}
          hitSlop={HIT_SLOP_8}
        >
          <Text style={styles.headerRestBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {block.notesExpanded && (
        <TextInput
          style={styles.notesInput}
          multiline
          value={block.notes}
          onChangeText={(v) => onNotesChange(blockIdx, v)}
          placeholder="Exercise notes..."
          placeholderTextColor={colors.textMuted}
          testID={`exercise-notes-${blockIdx}`}
        />
      )}
    </View>
  );
}, (prev, next) => {
  // Custom areEqual: skip comparing stable callbacks, deep-check only what matters
  if (prev.block !== next.block) return false;
  if (prev.blockIdx !== next.blockIdx) return false;
  if (prev.upcomingTargets !== next.upcomingTargets) return false;
  // O(1) string comparison for validation errors (pre-computed in parent)
  if (prev.blockErrorKey !== next.blockErrorKey) return false;
  // All callbacks (isPRSet, onToggleRestTimer, etc.) are stable via useCallback([])
  return true;
});

export default ExerciseBlockItem;

// ─── Styles ───

const styles = StyleSheet.create({
  // Exercise card
  exerciseCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  exerciseHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  exerciseNameContainer: {
    flex: 1,
  },
  exerciseName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  coachTipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
    minHeight: layout.touchMin,
  },
  coachTipLabel: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
  coachTipContent: {
    backgroundColor: 'rgba(124, 92, 252, 0.15)',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  coachTipText: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  restTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  headerRestBtn: {
    flex: 1,
    height: spacing.xl,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRestBtnText: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  headerRestDisplay: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    minWidth: 44,
    textAlign: 'center',
  },
  headerRestDisplayOff: {
    color: colors.textMuted,
  },
  // Set header
  setHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.xxs,
  },
  setHeaderCell: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  setNumCol: { width: 36, alignItems: 'center', justifyContent: 'center' },
  colFlex: { flex: 1.2, marginHorizontal: spacing.xs },
  colRpe: { width: 40, marginHorizontal: spacing.xs },
  checkCol: { width: 44, alignItems: 'center', marginLeft: spacing.xs },

  // Set row
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingVertical: 10,
    paddingLeft: spacing.xxs,
    paddingRight: spacing.sm,
    borderRadius: borderRadius.md,
  },
  setRowCompleted: {
    backgroundColor: colors.successBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
  },
  setRowWarmup: {
    backgroundColor: colors.warningBg,
  },
  setNum: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  setNumBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setNumBadgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: fontWeight.bold,
  },
  setInput: {
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    borderRadius: borderRadius.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
  },
  setInputError: {
    backgroundColor: colors.errorBg,
  },
  prBadge: {
    position: 'absolute',
    right: -4,
    top: -4,
    backgroundColor: colors.warning,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  prBadgeText: {
    color: colors.black,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  swipeDeleteContainer: {
    backgroundColor: colors.error,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: borderRadius.md,
  },
  swipeDeleteContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  swipeDeleteLabel: {
    color: colors.white,
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
  },

  // Checkbox
  checkBox: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxDone: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },

  // Exercise actions
  exerciseActions: {
    flexDirection: 'row',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceLight,
  },
  actionBtnText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginLeft: spacing.xs,
  },
  actionBtnTextMuted: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginLeft: spacing.xs,
  },
  removeExerciseBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: 'transparent',
  },
  notesInput: {
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    fontSize: fontSize.sm,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
    minHeight: 48,
    textAlignVertical: 'top',
  },
});
