// WorkoutScreen - handles both idle and active workout states
import React, { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  LayoutAnimation,
  UIManager,
  Platform,
} from 'react-native';
import { useRestTimer } from '../hooks/useRestTimer';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNotesDebounce } from '../hooks/useNotesDebounce';
import { useWidgetBridge } from '../hooks/useWidgetBridge';
import { useExerciseBlocks } from '../hooks/useExerciseBlocks';
import { useSetCompletion } from '../hooks/useSetCompletion';
import { useWorkoutLifecycle } from '../hooks/useWorkoutLifecycle';
import type { ExerciseBlock } from '../types/workout';
import type { Workout } from '../types/database';
import { colors, spacing, fontSize, modalStyles } from '../theme';
import { MUSCLE_GROUPS, EXERCISE_TYPE_OPTIONS_WITH_ICONS } from '../constants/exercise';
import { filterExercises } from '../utils/exerciseSearch';
import {
  startWorkoutActivity,
} from '../services/liveActivity';
import { RestTimerBar, ElapsedTimer } from '../components/WorkoutTimers';
import ExerciseHistoryModal from '../components/ExerciseHistoryModal';
import ExerciseBlockItem from '../components/ExerciseBlockItem';
import WorkoutSummary from '../components/WorkoutSummary';
import NoActiveWorkout from '../components/WorkoutIdleScreen';
import ConfettiCannon from 'react-native-confetti-cannon';
import { styles } from './WorkoutScreen.styles';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Pre-allocated style/hitSlop objects to avoid re-creation in render loops
const HIT_SLOP_10 = { top: 10, bottom: 10, left: 10, right: 10 };

// ─── Main Component ───

export default function WorkoutScreen() {
  // Shared refs (created at component level to avoid circular hook deps)
  const [showConfetti, setShowConfetti] = useState(false);
  const blocksRef = useRef<ExerciseBlock[]>([]);
  const workoutRef = useRef<Workout | null>(null);

  // Notes debouncing (extracted to hook)
  const { debouncedSaveNotes, flushPendingNotes, clearPendingNotes } = useNotesDebounce();

  // Rest timer (extracted to hook)
  const syncWidgetStateRef = useRef<(blocks?: ExerciseBlock[], isResting?: boolean, restEnd?: number) => void>(() => {});
  const onRestEnd = useCallback(() => {
    syncWidgetStateRef.current(undefined, false, 0);
  }, []);
  const onRestUpdate = useCallback((resting: boolean, endTime: number) => {
    syncWidgetStateRef.current(undefined, resting, endTime);
  }, []);
  const {
    restTotal, restExerciseName,
    isResting, currentEndTime,
    startRestTimer, adjustRestTimer, dismissRest,
  } = useRestTimer({ onRestEnd, onRestUpdate });

  // Widget bridge hook
  const {
    lastActiveBlockRef,
    syncWidgetState,
  } = useWidgetBridge({
    blocksRef,
    isResting,
    restEndTime: currentEndTime,
  });

  // Keep ref in sync so rest timer callbacks always get latest syncWidgetState
  syncWidgetStateRef.current = syncWidgetState;

  // Exercise blocks hook (state + mutation handlers)
  const {
    exerciseBlocks, setExerciseBlocks,
    originalBestE1RMRef, currentBestE1RMRef, prSetIdsRef,
    flushPendingSetWrites, clearPendingSetWrites,
    handleSetChange, handleCycleTag, handleAddSet, handleDeleteSet,
    handleToggleNotes, handleToggleRestTimer, handleAdjustExerciseRest,
    handleNotesChange, handleRemoveExercise,
  } = useExerciseBlocks({
    workoutRef,
    blocksRef,
    lastActiveBlockRef,
    debouncedSaveNotes,
  });

  // Workout lifecycle hook (loading, start/finish, add exercise, etc.)
  const lifecycle = useWorkoutLifecycle({
    workoutRef,
    setExerciseBlocks,
    exerciseBlocks,
    blocksRef,
    originalBestE1RMRef,
    currentBestE1RMRef,
    prSetIdsRef,
    lastActiveBlockRef,
    syncWidgetState,
    dismissRest,
    debouncedSaveNotes,
    flushPendingNotes,
    clearPendingNotes,
    flushPendingSetWrites,
    clearPendingSetWrites,
    startWorkoutActivity,
  });

  // Set completion hook (handleToggleComplete, validation, reorder toast)
  const {
    validationErrors, reorderToast,
    reorderToastTimer,
    handleToggleComplete,
  } = useSetCompletion({
    blocksRef,
    setExerciseBlocks,
    upcomingTargetsRef: lifecycle.upcomingTargetsRef,
    prSetIdsRef,
    originalBestE1RMRef,
    currentBestE1RMRef,
    lastActiveBlockRef,
    startRestTimer,
    syncWidgetState,
    onConfetti: useCallback(() => setShowConfetti(true), []),
  });

  // Stable callback for PR badge checks (avoids passing Set as prop)
  const isPRSet = useCallback((setId: string) => prSetIdsRef.current.has(setId), []);

  // Cleanup on unmount: flush pending writes, clear timers
  useEffect(() => {
    return () => {
      if (reorderToastTimer.current) clearTimeout(reorderToastTimer.current);
      flushPendingSetWrites();
      flushPendingNotes();
    };
  }, []);

  // ─── Memoized values ───

  const { completedSetsCount, totalSetsCount } = useMemo(() => ({
    completedSetsCount: exerciseBlocks.reduce((sum, b) => sum + b.sets.filter(s => s.is_completed).length, 0),
    totalSetsCount: exerciseBlocks.reduce((sum, b) => sum + b.sets.length, 0),
  }), [exerciseBlocks]);

  const filteredExercises = useMemo(
    () => filterExercises(lifecycle.availableExercises, lifecycle.exerciseSearch),
    [lifecycle.availableExercises, lifecycle.exerciseSearch],
  );

  // Pre-compute per-block validation error keys for O(1) areEqual comparison
  const blockErrorKeys = useMemo(() => {
    const lists: Record<number, string[]> = {};
    for (const key of Object.keys(validationErrors)) {
      const bi = parseInt(key.split('-')[0], 10);
      (lists[bi] ??= []).push(key);
    }
    const map: Record<number, string> = {};
    for (const [bi, keys] of Object.entries(lists)) {
      map[Number(bi)] = keys.sort().join(',');
    }
    return map;
  }, [validationErrors]);

  // ─── Render ───

  if (lifecycle.loading) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (lifecycle.showSummary) {
    return (
      <WorkoutSummary
        summaryStats={lifecycle.summaryStats}
        templateUpdatePlan={lifecycle.templateUpdatePlan}
        templateChangeDescriptions={lifecycle.templateChangeDescriptions}
        onUpdateTemplate={lifecycle.handleUpdateTemplate}
        onDismiss={lifecycle.handleDismissSummary}
      />
    );
  }

  if (!lifecycle.activeWorkout) {
    return (
      <>
        <NoActiveWorkout templates={lifecycle.templates} upcomingWorkout={lifecycle.upcomingWorkout} onStartTemplate={lifecycle.handleTemplatePress} onStartEmpty={lifecycle.handleStartEmpty} onStartUpcoming={lifecycle.handleStartFromUpcoming} startingTemplateId={lifecycle.startingTemplateId} lastPerformed={lifecycle.lastPerformed} />
        <Modal
          visible={!!lifecycle.previewTemplate}
          transparent
          animationType="fade"
          onRequestClose={() => lifecycle.setPreviewTemplate(null)}
        >
          <TouchableOpacity
            style={modalStyles.overlay}
            activeOpacity={1}
            onPress={() => lifecycle.setPreviewTemplate(null)}
          >
            <TouchableOpacity activeOpacity={1} style={[modalStyles.card, { maxHeight: '70%' }]}>
              <Text style={modalStyles.title}>{lifecycle.previewTemplate?.name}</Text>

              {lifecycle.loadingPreview ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />
              ) : (
                <FlatList
                  data={lifecycle.previewExercises}
                  keyExtractor={(item) => item.id}
                  style={{ marginVertical: spacing.md }}
                  renderItem={({ item, index }) => (
                    <View style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingVertical: spacing.sm,
                      borderBottomWidth: index < lifecycle.previewExercises.length - 1 ? 1 : 0,
                      borderBottomColor: colors.border,
                    }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontSize: fontSize.md }}>
                          {item.exercise?.name}
                        </Text>
                        <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>
                          {item.warmup_sets > 0 ? `${item.warmup_sets}W + ${item.default_sets} sets` : `${item.default_sets} sets`} · {item.exercise?.muscle_groups?.join(', ') || item.exercise?.type}
                        </Text>
                      </View>
                    </View>
                  )}
                  ListEmptyComponent={
                    <Text style={{ color: colors.textMuted, textAlign: 'center' as const, marginVertical: spacing.lg }}>
                      No exercises in this template
                    </Text>
                  }
                />
              )}

              <View style={[modalStyles.actions, { justifyContent: 'space-between' }]}>
                <TouchableOpacity
                  style={[modalStyles.cancelBtn, { borderWidth: 1, borderColor: colors.error }]}
                  onPress={() => lifecycle.setPreviewTemplate(null)}
                >
                  <Text style={[modalStyles.cancelText, { color: colors.error }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[modalStyles.confirmBtn, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    if (lifecycle.previewTemplate) {
                      lifecycle.setPreviewTemplate(null);
                      lifecycle.handleStartFromTemplate(lifecycle.previewTemplate);
                    }
                  }}
                  testID="start-from-template-btn"
                >
                  <Text style={modalStyles.confirmText}>Start Workout</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow1}>
          <TouchableOpacity onPress={lifecycle.handleCancelWorkout} hitSlop={HIT_SLOP_10} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }} testID="cancel-workout-btn">
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {lifecycle.templateName ?? 'Workout'}
          </Text>
          <TouchableOpacity style={styles.finishBtn} onPress={lifecycle.handleFinish} testID="finish-workout-btn">
            <Ionicons name="checkmark" size={16} color={colors.white} style={{ marginRight: 4 }} />
            <Text style={styles.finishBtnText}>Finish</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerRow2}>
          <View style={styles.timerRow}>
            <Ionicons name="time-outline" size={16} color={colors.primary} style={{ marginRight: 4 }} />
            {lifecycle.activeWorkout?.started_at && <ElapsedTimer startedAt={lifecycle.activeWorkout.started_at} />}
          </View>
          <Text style={styles.headerProgress} testID="sets-progress">{completedSetsCount}/{totalSetsCount} sets</Text>
        </View>
      </View>

      {reorderToast && (
        <View style={styles.reorderToast}>
          <Ionicons name="swap-vertical" size={14} color={colors.primary} style={{ marginRight: spacing.xs }} />
          <Text style={styles.reorderToastText}>{reorderToast} moved up</Text>
        </View>
      )}

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="always">
        {exerciseBlocks.map((block, blockIdx) => (
          <ExerciseBlockItem
            key={block.exercise.id}
            block={block}
            blockIdx={blockIdx}
            upcomingTargets={lifecycle.upcomingTargets}
            blockErrorKey={blockErrorKeys[blockIdx] ?? ''}
            isPRSet={isPRSet}
            onToggleRestTimer={handleToggleRestTimer}
            onAdjustRest={handleAdjustExerciseRest}
            onCycleTag={handleCycleTag}
            onDeleteSet={handleDeleteSet}
            onSetChange={handleSetChange}
            onToggleComplete={handleToggleComplete}
            onAddSet={handleAddSet}
            onToggleNotes={handleToggleNotes}
            onRemoveExercise={handleRemoveExercise}
            onNotesChange={handleNotesChange}
            onExercisePress={lifecycle.setHistoryExercise}
          />
        ))}

        {/* Add Exercise button */}
        <TouchableOpacity style={styles.addExerciseBtn} onPress={lifecycle.handleOpenAddExercise} activeOpacity={0.7} testID="add-exercise-btn">
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} style={{ marginRight: spacing.sm }} />
          <Text style={styles.addExerciseBtnText}>Add Exercise</Text>
        </TouchableOpacity>

        {/* Session Notes */}
        <View style={styles.sessionNotesSection}>
          <View style={styles.sessionNotesHeader}>
            <Ionicons name="document-text-outline" size={16} color={colors.textMuted} style={{ marginRight: spacing.xs }} />
            <Text style={styles.sessionNotesLabel}>Session Notes</Text>
          </View>
          <TextInput
            style={styles.sessionNotesInput}
            value={lifecycle.workoutNotes}
            onChangeText={lifecycle.handleSessionNotesChange}
            placeholder="Jot down thoughts about this session..."
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            testID="session-notes-input"
          />
        </View>

      </ScrollView>

      {/* Rest timer bar */}
      {isResting && currentEndTime > 0 && (
        <RestTimerBar
          endTime={currentEndTime}
          totalSeconds={restTotal}
          exerciseName={restExerciseName}
          onAdjust={adjustRestTimer}
          onDismiss={dismissRest}
        />
      )}

      {/* Add exercise modal — lazy-mounted */}
      {lifecycle.showAddExercise && (
      <Modal visible transparent animationType="slide" onRequestClose={() => lifecycle.setShowAddExercise(false)}>
        <View style={styles.addExerciseModal}>
          <View style={styles.addExerciseModalHeader}>
            <Text style={styles.addExerciseModalTitle}>Add Exercise</Text>
            <TouchableOpacity onPress={() => lifecycle.setShowAddExercise(false)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.addExerciseSearchContainer}>
            <Ionicons name="search-outline" size={16} color={colors.textMuted} style={{ marginRight: spacing.sm }} />
            <TextInput
              style={styles.addExerciseSearchInput}
              value={lifecycle.exerciseSearch}
              onChangeText={lifecycle.setExerciseSearch}
              placeholder="Search exercises..."
              placeholderTextColor={colors.textMuted}
              autoFocus
              testID="exercise-search"
            />
          </View>
          <TouchableOpacity
            style={styles.createToggleInModal}
            onPress={() => lifecycle.setShowCreateInWorkout(!lifecycle.showCreateInWorkout)}
          >
            <Ionicons name={lifecycle.showCreateInWorkout ? 'chevron-up' : 'add-circle-outline'} size={18} color={colors.primary} style={{ marginRight: spacing.sm }} />
            <Text style={styles.createToggleText}>
              {lifecycle.showCreateInWorkout ? 'Hide Form' : 'Create New Exercise'}
            </Text>
          </TouchableOpacity>

          {lifecycle.showCreateInWorkout && (
            <ScrollView style={styles.createFormInModal} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              <Text style={styles.createLabel}>Name</Text>
              <TextInput
                style={[styles.createInput, lifecycle.newExValidation ? { borderColor: colors.error } : null]}
                value={lifecycle.newExName}
                onChangeText={(v) => { lifecycle.setNewExName(v); lifecycle.setNewExValidation(''); }}
                placeholder='e.g. "Incline Dumbbell Press"'
                placeholderTextColor={colors.textMuted}
                testID="workout-exercise-name-input"
              />
              {lifecycle.newExValidation ? <Text style={styles.createErrorText}>{lifecycle.newExValidation}</Text> : null}

              <Text style={styles.createLabel}>Type</Text>
              <View style={styles.createChipRow}>
                {EXERCISE_TYPE_OPTIONS_WITH_ICONS.map((t) => (
                  <TouchableOpacity
                    key={t.value}
                    style={[styles.createChip, lifecycle.newExType === t.value && styles.createChipSelected]}
                    onPress={() => lifecycle.setNewExType(t.value)}
                  >
                    <Text style={[styles.createChipText, lifecycle.newExType === t.value && styles.createChipTextSelected]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.createLabel}>Muscle Groups</Text>
              <View style={styles.createChipRow}>
                {MUSCLE_GROUPS.map((mg) => {
                  const sel = lifecycle.newExMuscles.includes(mg);
                  return (
                    <TouchableOpacity
                      key={mg}
                      style={[styles.createChip, sel && styles.createChipSelected]}
                      onPress={() => lifecycle.setNewExMuscles((prev) => sel ? prev.filter(m => m !== mg) : [...prev, mg])}
                    >
                      <Text style={[styles.createChipText, sel && styles.createChipTextSelected]}>{mg}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.createLabel}>Description (optional)</Text>
              <TextInput
                style={[styles.createInput, { minHeight: 50, textAlignVertical: 'top' }]}
                value={lifecycle.newExDescription}
                onChangeText={lifecycle.setNewExDescription}
                placeholder="Form cues, setup notes..."
                placeholderTextColor={colors.textMuted}
                multiline
              />

              <TouchableOpacity style={styles.createSaveBtn} onPress={lifecycle.handleCreateAndAddExercise}>
                <Ionicons name="checkmark-circle" size={18} color={colors.white} style={{ marginRight: spacing.sm }} />
                <Text style={styles.createSaveBtnText}>Save & Add to Workout</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          <FlatList
            data={filteredExercises}
            keyExtractor={(item) => item.id}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: e }) => (
              <TouchableOpacity
                style={styles.addExerciseItem}
                onPress={() => lifecycle.handleAddExerciseToWorkout(e)}
                activeOpacity={0.7}
                testID={`exercise-item-${e.name.replace(/\s+/g, '-')}`}
              >
                <Text style={styles.addExerciseItemName}>{e.name}</Text>
                <Text style={styles.addExerciseItemMeta}>
                  {e.type} · {e.muscle_groups.join(', ') || 'No muscles set'}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
      )}

      {/* Finish confirmation modal — lazy-mounted */}
      {lifecycle.showFinishModal && (
      <Modal visible transparent animationType="fade" onRequestClose={() => lifecycle.setShowFinishModal(false)}>
        <TouchableOpacity style={modalStyles.overlay} activeOpacity={1} onPress={() => lifecycle.setShowFinishModal(false)}>
          <TouchableOpacity activeOpacity={1} style={modalStyles.card}>
            <Text style={modalStyles.title}>Finish Workout</Text>
            <Text style={modalStyles.subtitle}>
              {completedSetsCount} of {totalSetsCount} sets completed. Finish this workout?
            </Text>
            <View style={[modalStyles.actions, { marginTop: 0 }]}>
              <TouchableOpacity onPress={() => lifecycle.setShowFinishModal(false)} style={modalStyles.cancelBtn}>
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={lifecycle.confirmFinish} style={[modalStyles.confirmBtn, { backgroundColor: colors.error }]}>
                <Text style={modalStyles.confirmText}>Finish</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      )}

      {/* Exercise history modal — lazy-mounted */}
      {lifecycle.historyExercise && (
      <ExerciseHistoryModal
        visible
        exercise={lifecycle.historyExercise}
        onClose={lifecycle.handleCloseHistoryModal}
      />
      )}

      {showConfetti && (
        <View style={styles.confettiContainer} pointerEvents="none">
          <ConfettiCannon
            count={150}
            origin={{ x: -10, y: 0 }}
            autoStart
            fadeOut
            onAnimationEnd={() => setShowConfetti(false)}
            colors={[colors.primary, colors.success, '#FFD700', colors.accent, '#FF6B6B']}
            explosionSpeed={350}
            fallSpeed={3000}
          />
        </View>
      )}
    </SafeAreaView>
  );
}
