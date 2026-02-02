import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Vibration,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { syncToSupabase, pullUpcomingWorkout } from '../services/sync';
import ExerciseHistoryModal from '../components/ExerciseHistoryModal';
import type { UpcomingWorkoutExercise, UpcomingWorkoutSet } from '../types/database';
import {
  getUpcomingWorkoutForToday,
  getAllTemplates,
  getTemplateExercises,
  getActiveWorkout,
  startWorkout,
  finishWorkout,
  addWorkoutSet,
  getWorkoutSets,
  updateWorkoutSet,
  deleteWorkoutSet,
  deleteWorkout,
  getExerciseHistory,
  getExerciseById,
  getAllExercises,
  createExercise,
} from '../services/database';
import type {
  Template,
  TemplateExercise,
  Workout,
  WorkoutSet,
  Exercise,
  SetTag,
  TrainingGoal,
  ExerciseType,
} from '../types/database';

// ─── Types for local state ───

interface PreviousSetData {
  weight: number;
  reps: number;
}

interface LocalSet {
  id: string;
  exercise_id: string;
  set_number: number;
  weight: string;
  reps: string;
  tag: SetTag;
  is_completed: boolean;
  previous?: PreviousSetData | null;
}

interface ExerciseBlock {
  exercise: Exercise;
  sets: LocalSet[];
  lastTime: string | null;
  notesExpanded: boolean;
  notes: string;
  restSeconds: number;
}

// ─── Rest timer defaults by training goal ───

const REST_SECONDS: Record<TrainingGoal, number> = {
  strength: 180,
  hypertrophy: 90,
  endurance: 60,
};

const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Forearms',
];

const EXERCISE_TYPES: { value: ExerciseType; label: string }[] = [
  { value: 'weighted', label: 'Weighted' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'machine', label: 'Machine' },
  { value: 'cable', label: 'Cable' },
];

// ─── Main Component ───

export default function WorkoutScreen() {
  const [loading, setLoading] = useState(true);
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);

  // Active workout state
  const [exerciseBlocks, setExerciseBlocks] = useState<ExerciseBlock[]>([]);
  const [elapsed, setElapsed] = useState('00:00');
  const [restSeconds, setRestSeconds] = useState(0);
  const [restTotal, setRestTotal] = useState(0);
  const [restExerciseName, setRestExerciseName] = useState('');
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryStats, setSummaryStats] = useState({ exercises: 0, sets: 0, volume: 0, duration: '' });
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [availableExercises, setAvailableExercises] = useState<Exercise[]>([]);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [showCreateInWorkout, setShowCreateInWorkout] = useState(false);
  const [newExName, setNewExName] = useState('');
  const [newExType, setNewExType] = useState<ExerciseType>('weighted');
  const [newExMuscles, setNewExMuscles] = useState<string[]>([]);
  const [newExDescription, setNewExDescription] = useState('');
  const [newExValidation, setNewExValidation] = useState('');
  const [historyExercise, setHistoryExercise] = useState<Exercise | null>(null);
  const [upcomingWorkout, setUpcomingWorkout] = useState<Awaited<ReturnType<typeof getUpcomingWorkoutForToday>>>(null);
  const [upcomingTargets, setUpcomingTargets] = useState<(UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workoutRef = useRef<Workout | null>(null);

  // ─── Check for active workout on focus ───

  useFocusEffect(
    useCallback(() => {
      loadState();
    }, []),
  );

  async function loadState() {
    setLoading(true);
    try {
      const active = await getActiveWorkout();
      setActiveWorkout(active);
      workoutRef.current = active;
      if (active) {
        setTemplateName(active.template_name ?? null);
        await loadActiveWorkout(active);
      } else {
        const t = await getAllTemplates();
        setTemplates(t);
        // Pull upcoming workout from Supabase (with timeout so it can't hang)
        try {
          await Promise.race([
            pullUpcomingWorkout(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
          ]);
        } catch (e) {
          console.error('pullUpcomingWorkout failed or timed out', e);
        }
        const upcoming = await getUpcomingWorkoutForToday();
        setUpcomingWorkout(upcoming);
      }
    } catch (e) {
      console.error('Failed to load workout state', e);
    } finally {
      setLoading(false);
    }
  }

  // ─── Load existing active workout from DB ───

  async function loadActiveWorkout(workout: Workout) {
    const sets = await getWorkoutSets(workout.id);
    const exerciseOrder: string[] = [];
    const exerciseMap: Record<string, WorkoutSet[]> = {};

    for (const s of sets) {
      if (!exerciseMap[s.exercise_id]) {
        exerciseMap[s.exercise_id] = [];
        exerciseOrder.push(s.exercise_id);
      }
      exerciseMap[s.exercise_id].push(s);
    }

    const blocks: ExerciseBlock[] = [];
    for (const exId of exerciseOrder) {
      const wSets = exerciseMap[exId];
      const exercise = await getExerciseById(exId);
      if (!exercise) continue;

      const lastTime = await formatLastTime(exId);
      const previousSets = await getPreviousSets(exId);
      const restoredNotes = wSets[0]?.notes ?? '';

      blocks.push({
        exercise,
        sets: wSets.map((s, idx) => ({
          id: s.id,
          exercise_id: s.exercise_id,
          set_number: s.set_number,
          weight: s.weight != null && s.weight > 0 ? String(s.weight) : '',
          reps: s.reps != null ? String(s.reps) : '',
          tag: s.tag,
          is_completed: s.is_completed,
          previous: previousSets[idx] ?? null,
        })),
        lastTime,
        notesExpanded: restoredNotes.length > 0,
        notes: restoredNotes,
        restSeconds: REST_SECONDS[exercise.training_goal],
      });
    }

    setExerciseBlocks(blocks);
    startElapsedTimer(workout.started_at);
  }

  // ─── Helpers ───

  async function getPreviousSets(exerciseId: string): Promise<PreviousSetData[]> {
    try {
      const hist = await getExerciseHistory(exerciseId, 1);
      if (hist.length === 0) return [];
      return hist[0].sets
        .filter((s) => s.is_completed)
        .map((s) => ({ weight: s.weight ?? 0, reps: s.reps ?? 0 }));
    } catch {
      return [];
    }
  }

  async function formatLastTime(exerciseId: string): Promise<string | null> {
    try {
      const hist = await getExerciseHistory(exerciseId, 1);
      if (hist.length === 0) return null;
      const sets = hist[0].sets.filter((s) => s.is_completed);
      if (sets.length === 0) return null;
      const setCount = sets.length;
      const avgReps = Math.round(sets.reduce((a, s) => a + (s.reps ?? 0), 0) / setCount);
      const maxWeight = Math.max(...sets.map((s) => s.weight ?? 0));
      return `Last: ${setCount}\u00D7${avgReps} @ ${maxWeight}lb`;
    } catch {
      return null;
    }
  }

  function startElapsedTimer(startedAt: string) {
    if (timerRef.current) clearInterval(timerRef.current);
    const update = () => {
      const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setElapsed(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    update();
    timerRef.current = setInterval(update, 1000);
  }

  function startRestTimer(seconds: number, exerciseName: string) {
    if (restRef.current) clearInterval(restRef.current);
    const total = seconds;
    setRestTotal(total);
    setRestSeconds(total);
    setRestExerciseName(exerciseName);
    restRef.current = setInterval(() => {
      setRestSeconds((prev) => {
        if (prev <= 1) {
          if (restRef.current) clearInterval(restRef.current);
          restRef.current = null;
          // Vibrate when timer ends
          try { Vibration.vibrate([0, 200, 100, 200]); } catch {}
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function adjustRestTimer(delta: number) {
    setRestSeconds((prev) => {
      const next = Math.max(0, prev + delta);
      if (next === 0 && restRef.current) {
        clearInterval(restRef.current);
        restRef.current = null;
      }
      return next;
    });
    setRestTotal((prev) => Math.max(prev + delta, 1));
  }

  function dismissRest() {
    if (restRef.current) clearInterval(restRef.current);
    restRef.current = null;
    setRestSeconds(0);
  }

  // ─── Build exercise blocks helper ───

  async function buildExerciseBlock(
    workoutId: string,
    exercise: Exercise,
    setCount: number,
    restSec?: number,
  ): Promise<ExerciseBlock> {
    const previousSets = await getPreviousSets(exercise.id);
    const sets: LocalSet[] = [];
    for (let i = 1; i <= setCount; i++) {
      const ws = await addWorkoutSet({
        workout_id: workoutId,
        exercise_id: exercise.id,
        set_number: i,
        reps: null,
        weight: null,
        tag: 'working',
        rpe: null,
        is_completed: false,
        notes: null,
      });
      sets.push({
        id: ws.id,
        exercise_id: exercise.id,
        set_number: i,
        weight: '',
        reps: '',
        tag: 'working',
        is_completed: false,
        previous: previousSets[i - 1] ?? null,
      });
    }
    const lastTime = await formatLastTime(exercise.id);
    return { exercise, sets, lastTime, notesExpanded: false, notes: '', restSeconds: restSec ?? REST_SECONDS[exercise.training_goal] };
  }

  function activateWorkout(workout: Workout, blocks: ExerciseBlock[], name: string | null = null) {
    setTemplateName(name);
    setActiveWorkout(workout);
    workoutRef.current = workout;
    setExerciseBlocks(blocks);
    startElapsedTimer(workout.started_at);
  }

  // ─── Start workout handlers ───

  async function handleStartFromTemplate(template: Template) {
    try {
      setLoading(true);
      const workout = await startWorkout(template.id);
      const templateExercises = await getTemplateExercises(template.id);

      const blocks: ExerciseBlock[] = [];
      for (const te of templateExercises) {
        if (!te.exercise) continue;
        blocks.push(await buildExerciseBlock(workout.id, te.exercise, te.default_sets, te.rest_seconds));
      }

      activateWorkout(workout, blocks, template.name);
    } catch (e) {
      console.error('Failed to start workout', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartEmpty() {
    try {
      setLoading(true);
      const workout = await startWorkout(null);
      activateWorkout(workout, []);
    } catch (e) {
      console.error('Failed to start empty workout', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartFromUpcoming() {
    if (!upcomingWorkout) return;
    try {
      setLoading(true);
      const workout = await startWorkout(upcomingWorkout.workout.template_id);
      const blocks: ExerciseBlock[] = [];

      for (const upEx of upcomingWorkout.exercises) {
        if (!upEx.exercise) continue;
        const setCount = Math.max((upEx.sets ?? []).length, 1);
        blocks.push(await buildExerciseBlock(workout.id, upEx.exercise, setCount, upEx.rest_seconds));
      }

      setUpcomingTargets(upcomingWorkout.exercises);
      activateWorkout(workout, blocks);
    } catch (e) {
      console.error('Failed to start upcoming workout', e);
    } finally {
      setLoading(false);
    }
  }

  // ─── Add exercise mid-workout ───

  async function handleOpenAddExercise() {
    const exercises = await getAllExercises();
    setAvailableExercises(exercises);
    setExerciseSearch('');
    setShowAddExercise(true);
  }

  async function handleAddExerciseToWorkout(exercise: Exercise) {
    const workout = workoutRef.current;
    if (!workout) return;

    setShowAddExercise(false);
    const previousSets = await getPreviousSets(exercise.id);
    const ws = await addWorkoutSet({
      workout_id: workout.id,
      exercise_id: exercise.id,
      set_number: 1,
      reps: null,
      weight: null,
      tag: 'working',
      rpe: null,
      is_completed: false,
      notes: null,
    });

    const lastTime = await formatLastTime(exercise.id);
    const newBlock: ExerciseBlock = {
      exercise,
      sets: [{
        id: ws.id,
        exercise_id: exercise.id,
        set_number: 1,
        weight: '',
        reps: '',
        tag: 'working',
        is_completed: false,
        previous: previousSets[0] ?? null,
      }],
      lastTime,
      notesExpanded: false,
      notes: '',
      restSeconds: REST_SECONDS[exercise.training_goal],
    };

    setExerciseBlocks((prev) => [...prev, newBlock]);
  }

  async function handleCreateAndAddExercise() {
    if (!newExName.trim()) {
      setNewExValidation('Exercise name is required');
      return;
    }
    setNewExValidation('');
    const exercise = await createExercise({
      name: newExName.trim(),
      type: newExType,
      muscle_groups: newExMuscles,
      training_goal: 'hypertrophy',
      description: newExDescription.trim(),
    });
    setNewExName('');
    setNewExType('weighted');
    setNewExMuscles([]);
    setNewExDescription('');
    setShowCreateInWorkout(false);
    await handleAddExerciseToWorkout(exercise);
  }

  // ─── Set manipulation helpers ───

  function updateBlockSet(blockIdx: number, setIdx: number, updates: Partial<LocalSet>) {
    setExerciseBlocks((prev) => {
      const next = [...prev];
      const block = { ...next[blockIdx], sets: [...next[blockIdx].sets] };
      block.sets[setIdx] = { ...block.sets[setIdx], ...updates };
      next[blockIdx] = block;
      return next;
    });
  }

  async function handleSetChange(
    blockIdx: number,
    setIdx: number,
    field: 'weight' | 'reps',
    value: string,
  ) {
    const set = exerciseBlocks[blockIdx]?.sets[setIdx];
    if (!set) return;

    updateBlockSet(blockIdx, setIdx, { [field]: value });

    const numVal = value === '' ? null : Number(value);
    await updateWorkoutSet(set.id, { [field]: numVal });
  }

  async function handleCycleTag(blockIdx: number, setIdx: number) {
    const set = exerciseBlocks[blockIdx]?.sets[setIdx];
    if (!set) return;
    const tags: SetTag[] = ['working', 'warmup', 'failure', 'drop'];
    const idx = tags.indexOf(set.tag);
    const newTag = tags[(idx + 1) % tags.length];
    updateBlockSet(blockIdx, setIdx, { tag: newTag });
    await updateWorkoutSet(set.id, { tag: newTag });
  }

  async function handleToggleComplete(blockIdx: number, setIdx: number) {
    const set = exerciseBlocks[blockIdx]?.sets[setIdx];
    if (!set) return;
    const newCompleted = !set.is_completed;

    updateBlockSet(blockIdx, setIdx, { is_completed: newCompleted });

    await updateWorkoutSet(set.id, {
      is_completed: newCompleted,
      weight: set.weight === '' ? null : Number(set.weight),
      reps: set.reps === '' ? null : Number(set.reps),
    });

    if (newCompleted) {
      // Haptic feedback
      try { Vibration.vibrate(50); } catch {}
      const block = exerciseBlocks[blockIdx];
      startRestTimer(block.restSeconds, block.exercise.name);
    }
  }

  async function handleAddSet(blockIdx: number) {
    const block = exerciseBlocks[blockIdx];
    const workout = workoutRef.current;
    if (!workout) return;

    const newSetNumber = block.sets.length + 1;
    const previousSets = await getPreviousSets(block.exercise.id);
    const ws = await addWorkoutSet({
      workout_id: workout.id,
      exercise_id: block.exercise.id,
      set_number: newSetNumber,
      reps: null,
      weight: null,
      tag: 'working',
      rpe: null,
      is_completed: false,
      notes: null,
    });

    setExerciseBlocks((prev) => {
      const next = [...prev];
      const b = { ...next[blockIdx], sets: [...next[blockIdx].sets] };
      b.sets.push({
        id: ws.id,
        exercise_id: block.exercise.id,
        set_number: newSetNumber,
        weight: '',
        reps: '',
        tag: 'working',
        is_completed: false,
        previous: previousSets[newSetNumber - 1] ?? null,
      });
      next[blockIdx] = b;
      return next;
    });
  }

  async function handleDeleteSet(blockIdx: number, setIdx: number) {
    const block = exerciseBlocks[blockIdx];
    const set = block.sets[setIdx];
    if (!set) return;

    // Don't allow deleting the last set
    if (block.sets.length <= 1) return;

    await deleteWorkoutSet(set.id);
    setExerciseBlocks((prev) => {
      const next = [...prev];
      const b = { ...next[blockIdx], sets: [...next[blockIdx].sets] };
      b.sets.splice(setIdx, 1);
      // Renumber
      b.sets.forEach((s, i) => { s.set_number = i + 1; });
      next[blockIdx] = b;
      return next;
    });
  }

  function handleToggleNotes(blockIdx: number) {
    setExerciseBlocks((prev) => {
      const next = [...prev];
      next[blockIdx] = { ...next[blockIdx], notesExpanded: !next[blockIdx].notesExpanded };
      return next;
    });
  }

  // ─── Cancel workout ───

  function handleCancelWorkout() {
    Alert.alert(
      'Cancel Workout',
      'Discard this workout? All progress will be lost.',
      [
        { text: 'Keep Going', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            const workout = workoutRef.current;
            if (workout) {
              await deleteWorkout(workout.id);
            }
            if (timerRef.current) clearInterval(timerRef.current);
            dismissRest();
            setActiveWorkout(null);
            workoutRef.current = null;
            setTemplateName(null);
            setExerciseBlocks([]);
            setUpcomingTargets(null);
            loadState();
          },
        },
      ],
    );
  }

  // ─── Finish workout ───

  function handleFinish() {
    setShowFinishModal(true);
  }

  async function confirmFinish() {
    setShowFinishModal(false);
    const workout = workoutRef.current;
    if (!workout) return;

    let totalSets = 0;
    let totalVolume = 0;
    let exerciseCount = exerciseBlocks.length;
    for (const block of exerciseBlocks) {
      for (const s of block.sets) {
        if (s.is_completed) {
          totalSets++;
          const w = s.weight === '' ? 0 : Number(s.weight);
          const r = s.reps === '' ? 0 : Number(s.reps);
          totalVolume += w * r;
        }
      }
    }

    const diff = Math.floor((Date.now() - new Date(workout.started_at).getTime()) / 1000);
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    const durationStr = `${m}m ${s}s`;

    await finishWorkout(workout.id);
    syncToSupabase().catch(console.error);

    if (timerRef.current) clearInterval(timerRef.current);
    dismissRest();

    // Celebration vibration
    try { Vibration.vibrate([0, 100, 50, 100, 50, 200]); } catch {}

    setSummaryStats({
      exercises: exerciseCount,
      sets: totalSets,
      volume: totalVolume,
      duration: durationStr,
    });
    setShowSummary(true);
  }

  function handleDismissSummary() {
    setShowSummary(false);
    setActiveWorkout(null);
    workoutRef.current = null;
    setTemplateName(null);
    setExerciseBlocks([]);
    loadState();
  }

  // ─── Cleanup ───

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (restRef.current) clearInterval(restRef.current);
    };
  }, []);

  // ─── Render ───

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (showSummary) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.summaryContainer}>
          <Ionicons name="checkmark-circle" size={64} color={colors.success} style={{ alignSelf: 'center', marginBottom: spacing.md }} />
          <Text style={styles.summaryTitle}>Workout Complete!</Text>
          <View style={styles.summaryCard}>
            <SummaryStat label="Duration" value={summaryStats.duration} icon="time-outline" />
            <SummaryStat label="Exercises" value={String(summaryStats.exercises)} icon="barbell-outline" />
            <SummaryStat label="Sets" value={String(summaryStats.sets)} icon="layers-outline" />
            <SummaryStat label="Volume" value={`${summaryStats.volume.toLocaleString()} lb`} icon="trending-up-outline" />
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleDismissSummary}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!activeWorkout) {
    return <NoActiveWorkout templates={templates} upcomingWorkout={upcomingWorkout} onStartTemplate={handleStartFromTemplate} onStartEmpty={handleStartEmpty} onStartUpcoming={handleStartFromUpcoming} />;
  }

  const completedSetsCount = exerciseBlocks.reduce((sum, b) => sum + b.sets.filter(s => s.is_completed).length, 0);
  const totalSetsCount = exerciseBlocks.reduce((sum, b) => sum + b.sets.length, 0);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow1}>
          <TouchableOpacity onPress={handleCancelWorkout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {templateName ?? 'Workout'}
          </Text>
          <TouchableOpacity style={styles.finishBtn} onPress={handleFinish} testID="finish-workout-btn">
            <Ionicons name="checkmark" size={16} color={colors.white} style={{ marginRight: 4 }} />
            <Text style={styles.finishBtnText}>Finish</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerRow2}>
          <View style={styles.timerRow}>
            <Ionicons name="time-outline" size={16} color={colors.primary} style={{ marginRight: 4 }} />
            <Text style={styles.headerTimer}>{elapsed}</Text>
          </View>
          <Text style={styles.headerProgress} testID="sets-progress">{completedSetsCount}/{totalSetsCount} sets</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="always">
        {exerciseBlocks.map((block, blockIdx) => (
          <View key={`${block.exercise.id}-${blockIdx}`} style={styles.exerciseCard}>
            <View style={styles.exerciseNameRow}>
              <TouchableOpacity onPress={() => setHistoryExercise(block.exercise)}>
                <Text style={styles.exerciseName}>{block.exercise.name}</Text>
              </TouchableOpacity>
            </View>

            {block.lastTime && (
              <Text style={styles.lastTimeText}>{block.lastTime}</Text>
            )}

            {/* Set header row */}
            <View style={styles.setHeaderRow}>
              <Text style={[styles.setHeaderCell, styles.setNumCol]}>SET</Text>
              <Text style={[styles.setHeaderCell, styles.colPrev]}>PREV</Text>
              {upcomingTargets && <Text style={[styles.setHeaderCell, styles.colTarget]}>TARGET</Text>}
              <Text style={[styles.setHeaderCell, styles.colFlex]}>LBS</Text>
              <Text style={[styles.setHeaderCell, styles.colFlex]}>REPS</Text>
              <Text style={[styles.setHeaderCell, styles.checkCol]} />
            </View>

            {/* Set rows */}
            {block.sets.map((set, setIdx) => {
              const tagLabel = set.tag === 'warmup' ? 'W' : set.tag === 'failure' ? 'F' : set.tag === 'drop' ? 'D' : null;
              const tagColor = set.tag === 'warmup' ? colors.warning : set.tag === 'failure' ? colors.error : set.tag === 'drop' ? colors.primary : undefined;
              const prevText = set.previous
                ? `${set.previous.weight}×${set.previous.reps}`
                : '—';
              return (
              <View
                key={set.id}
                style={[
                  styles.setRow,
                  set.is_completed && styles.setRowCompleted,
                ]}
              >
                <TouchableOpacity
                  style={styles.setNumCol}
                  onPress={() => handleCycleTag(blockIdx, setIdx)}
                  onLongPress={() => handleDeleteSet(blockIdx, setIdx)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
                <Text style={[styles.previousCol, styles.colPrev]} numberOfLines={1}>
                  {prevText}
                </Text>
                {upcomingTargets && <TargetCell upcomingTargets={upcomingTargets} exerciseId={block.exercise.id} setNumber={set.set_number} />}
                <TextInput
                  style={[styles.setInput, styles.colFlex]}
                  keyboardType="numeric"
                  value={set.weight}
                  onChangeText={(v) => handleSetChange(blockIdx, setIdx, 'weight', v)}
                  placeholder={set.previous ? String(set.previous.weight) : ''}
                  placeholderTextColor={colors.textMuted}
                  testID={`weight-${blockIdx}-${setIdx}`}
                />
                <TextInput
                  style={[styles.setInput, styles.colFlex]}
                  keyboardType="numeric"
                  value={set.reps}
                  onChangeText={(v) => handleSetChange(blockIdx, setIdx, 'reps', v)}
                  placeholder={set.previous ? String(set.previous.reps) : ''}
                  placeholderTextColor={colors.textMuted}
                  testID={`reps-${blockIdx}-${setIdx}`}
                />
                <TouchableOpacity
                  style={[styles.checkBox, set.is_completed && styles.checkBoxDone]}
                  onPress={() => handleToggleComplete(blockIdx, setIdx)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: set.is_completed }}
                  testID={`check-${blockIdx}-${setIdx}`}
                >
                  {set.is_completed && (
                    <Ionicons name="checkmark" size={18} color={colors.white} />
                  )}
                </TouchableOpacity>
              </View>
              );
            })}

            {/* Add set + notes */}
            <View style={styles.exerciseActions}>
              <TouchableOpacity style={styles.addSetBtn} onPress={() => handleAddSet(blockIdx)}>
                <Ionicons name="add" size={16} color={colors.primary} />
                <Text style={styles.addSetText}>Add Set</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleToggleNotes(blockIdx)}>
                <Text style={styles.notesToggle}>
                  {block.notesExpanded ? 'Hide Notes' : 'Notes'}
                </Text>
              </TouchableOpacity>
            </View>

            {block.notesExpanded && (
              <TextInput
                style={styles.notesInput}
                multiline
                value={block.notes}
                onChangeText={(v) => {
                  setExerciseBlocks((prev) => {
                    const next = [...prev];
                    next[blockIdx] = { ...next[blockIdx], notes: v };
                    return next;
                  });
                  // Persist notes on the first set of this exercise block
                  const firstSet = exerciseBlocks[blockIdx]?.sets[0];
                  if (firstSet) {
                    updateWorkoutSet(firstSet.id, { notes: v });
                  }
                }}
                placeholder="Exercise notes..."
                placeholderTextColor={colors.textMuted}
              />
            )}
          </View>
        ))}

        {/* Add Exercise button */}
        <TouchableOpacity style={styles.addExerciseBtn} onPress={handleOpenAddExercise} activeOpacity={0.7} testID="add-exercise-btn">
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} style={{ marginRight: spacing.sm }} />
          <Text style={styles.addExerciseBtnText}>Add Exercise</Text>
        </TouchableOpacity>


      </ScrollView>

      {/* Rest timer bar */}
      {restSeconds > 0 && (
        <View style={styles.restBar}>
          <View style={styles.restBarHeader}>
            <Text style={styles.restBarLabel}>Rest — {restExerciseName}</Text>
            <Text style={styles.restBarTime}>
              {Math.floor(restSeconds / 60)}:{String(restSeconds % 60).padStart(2, '0')}
            </Text>
          </View>
          <View style={styles.restBarInner}>
            <View
              style={[
                styles.restBarFill,
                { width: `${(restSeconds / restTotal) * 100}%` },
              ]}
            />
          </View>
          <View style={styles.restBarActions}>
            <TouchableOpacity style={styles.restAdjustBtn} onPress={() => adjustRestTimer(-15)}>
              <Text style={styles.restAdjustText}>-15s</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.restAdjustBtn} onPress={() => adjustRestTimer(15)}>
              <Text style={styles.restAdjustText}>+15s</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.restSkipBtn} onPress={dismissRest}>
              <Text style={styles.restSkipText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Add exercise modal */}
      <Modal visible={showAddExercise} transparent animationType="slide">
        <View style={styles.addExerciseModal}>
          <View style={styles.addExerciseModalHeader}>
            <Text style={styles.addExerciseModalTitle}>Add Exercise</Text>
            <TouchableOpacity onPress={() => setShowAddExercise(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.addExerciseSearchContainer}>
            <Ionicons name="search-outline" size={16} color={colors.textMuted} style={{ marginRight: spacing.sm }} />
            <TextInput
              style={styles.addExerciseSearchInput}
              value={exerciseSearch}
              onChangeText={setExerciseSearch}
              placeholder="Search exercises..."
              placeholderTextColor={colors.textMuted}
              autoFocus
              testID="exercise-search"
            />
          </View>
          <TouchableOpacity
            style={styles.createToggleInModal}
            onPress={() => setShowCreateInWorkout(!showCreateInWorkout)}
          >
            <Ionicons name={showCreateInWorkout ? 'chevron-up' : 'add-circle-outline'} size={18} color={colors.primary} style={{ marginRight: spacing.sm }} />
            <Text style={styles.createToggleText}>
              {showCreateInWorkout ? 'Hide Form' : 'Create New Exercise'}
            </Text>
          </TouchableOpacity>

          {showCreateInWorkout && (
            <ScrollView style={styles.createFormInModal} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              <Text style={styles.createLabel}>Name</Text>
              <TextInput
                style={[styles.createInput, newExValidation ? { borderColor: colors.error } : null]}
                value={newExName}
                onChangeText={(v) => { setNewExName(v); setNewExValidation(''); }}
                placeholder='e.g. "Incline Dumbbell Press"'
                placeholderTextColor={colors.textMuted}
                testID="workout-exercise-name-input"
              />
              {newExValidation ? <Text style={styles.createErrorText}>{newExValidation}</Text> : null}

              <Text style={styles.createLabel}>Type</Text>
              <View style={styles.createChipRow}>
                {EXERCISE_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.value}
                    style={[styles.createChip, newExType === t.value && styles.createChipSelected]}
                    onPress={() => setNewExType(t.value)}
                  >
                    <Text style={[styles.createChipText, newExType === t.value && styles.createChipTextSelected]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.createLabel}>Muscle Groups</Text>
              <View style={styles.createChipRow}>
                {MUSCLE_GROUPS.map((mg) => {
                  const sel = newExMuscles.includes(mg);
                  return (
                    <TouchableOpacity
                      key={mg}
                      style={[styles.createChip, sel && styles.createChipSelected]}
                      onPress={() => setNewExMuscles((prev) => sel ? prev.filter(m => m !== mg) : [...prev, mg])}
                    >
                      <Text style={[styles.createChipText, sel && styles.createChipTextSelected]}>{mg}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.createLabel}>Description (optional)</Text>
              <TextInput
                style={[styles.createInput, { minHeight: 50, textAlignVertical: 'top' }]}
                value={newExDescription}
                onChangeText={setNewExDescription}
                placeholder="Form cues, setup notes..."
                placeholderTextColor={colors.textMuted}
                multiline
              />

              <TouchableOpacity style={styles.createSaveBtn} onPress={handleCreateAndAddExercise}>
                <Ionicons name="checkmark-circle" size={18} color={colors.white} style={{ marginRight: spacing.sm }} />
                <Text style={styles.createSaveBtnText}>Save & Add to Workout</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {availableExercises
              .filter(e => e.name.toLowerCase().includes(exerciseSearch.toLowerCase()))
              .map(e => (
                <TouchableOpacity
                  key={e.id}
                  style={styles.addExerciseItem}
                  onPress={() => handleAddExerciseToWorkout(e)}
                  activeOpacity={0.7}
                  testID={`exercise-item-${e.name.replace(/\s+/g, '-')}`}
                >
                  <Text style={styles.addExerciseItemName}>{e.name}</Text>
                  <Text style={styles.addExerciseItemMeta}>
                    {e.type} · {e.muscle_groups.join(', ') || 'No muscles set'}
                  </Text>
                </TouchableOpacity>
              ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Finish confirmation modal */}
      <Modal visible={showFinishModal} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowFinishModal(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            <Text style={styles.modalTitle}>Finish Workout</Text>
            <Text style={styles.modalSub}>
              {completedSetsCount} of {totalSetsCount} sets completed. Finish this workout?
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setShowFinishModal(false)} style={styles.modalCancelBtn}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmFinish} style={styles.modalFinishBtn}>
                <Text style={styles.modalFinishText}>Finish</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ExerciseHistoryModal
        visible={!!historyExercise}
        exercise={historyExercise}
        onClose={() => setHistoryExercise(null)}
      />
    </SafeAreaView>
  );
}

// ─── Sub-components ───

function NoActiveWorkout({
  templates,
  upcomingWorkout,
  onStartTemplate,
  onStartEmpty,
  onStartUpcoming,
}: {
  templates: Template[];
  upcomingWorkout: Awaited<ReturnType<typeof getUpcomingWorkoutForToday>>;
  onStartTemplate: (t: Template) => void;
  onStartEmpty: () => void;
  onStartUpcoming: () => void;
}) {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.noActiveContent}>
        <View style={styles.heroSection}>
          <Ionicons name="barbell-outline" size={48} color={colors.primary} />
          <Text style={styles.heroTitle}>Start Workout</Text>
          <Text style={styles.heroSub}>Choose a template or start from scratch.</Text>
        </View>

        {upcomingWorkout && (
          <TouchableOpacity style={styles.upcomingCard} onPress={onStartUpcoming}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Ionicons name="sparkles" size={20} color={colors.primary} style={{ marginRight: 8 }} />
              <Text style={styles.upcomingTitle}>Workout Ready</Text>
            </View>
            <Text style={styles.upcomingSubtitle}>
              {upcomingWorkout.exercises.length} exercises
              {upcomingWorkout.workout.notes ? ` · ${upcomingWorkout.workout.notes}` : ''}
            </Text>
            <View style={styles.upcomingBtn}>
              <Text style={styles.upcomingBtnText}>Start Workout</Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.emptyBtn} onPress={onStartEmpty} testID="start-empty-workout">
          <Ionicons name="flash-outline" size={20} color={colors.white} style={{ marginRight: spacing.sm }} />
          <Text style={styles.emptyBtnText}>Start Empty Workout</Text>
        </TouchableOpacity>

        {templates.length > 0 && (
          <>
            <Text style={styles.templateHeader}>TEMPLATES</Text>
            {templates.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={styles.templateCard}
                onPress={() => onStartTemplate(t)}
              >
                <View style={styles.templateCardLeft} />
                <View style={styles.templateCardBody}>
                  <Text style={styles.templateName}>{t.name}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </>
        )}

        {templates.length === 0 && (
          <Text style={styles.noTemplates}>
            No templates yet. Create one in the Templates tab.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TargetCell({ upcomingTargets, exerciseId, setNumber }: {
  upcomingTargets: (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[];
  exerciseId: string;
  setNumber: number;
}) {
  const target = upcomingTargets
    .find(e => e.exercise_id === exerciseId)
    ?.sets?.find(s => s.set_number === setNumber);
  return (
    <Text style={[styles.targetCol, styles.colTarget]} numberOfLines={1}>
      {target ? `${target.target_weight}×${target.target_reps}` : '—'}
    </Text>
  );
}

function SummaryStat({ label, value, icon }: { label: string; value: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.summaryStatRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {icon && <Ionicons name={icon} size={16} color={colors.textSecondary} style={{ marginRight: spacing.sm }} />}
        <Text style={styles.summaryStatLabel}>{label}</Text>
      </View>
      <Text style={styles.summaryStatValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ───

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Header
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  headerRow1: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  headerRow2: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  headerTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTimer: {
    color: colors.primary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  headerProgress: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
  },
  finishBtn: {
    backgroundColor: colors.success,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  finishBtnText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },

  // ScrollView
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: 200,
    maxWidth: 500,
    alignSelf: 'center' as any,
    width: '100%' as any,
  },

  // Exercise card
  exerciseCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
  },
  exerciseNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  exerciseName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    flex: 1,
  },
  lastTimeText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  // Set header
  setHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  setHeaderCell: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
    letterSpacing: 1,
    textTransform: 'uppercase' as any,
  },
  setNumCol: { width: 36, alignItems: 'center' as any, justifyContent: 'center' as any },
  colPrev: { flex: 1, marginHorizontal: 4 },
  colFlex: { flex: 1, marginHorizontal: 4 },
  checkCol: { width: 44, alignItems: 'center' as any },

  // Set row
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
  },
  setRowCompleted: {
    backgroundColor: 'rgba(82, 199, 124, 0.08)',
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
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
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
  },
  setNumBadgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: fontWeight.bold,
  },
  previousCol: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  setInput: {
    backgroundColor: colors.surfaceLight,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    borderRadius: borderRadius.sm,
    paddingVertical: 8,
    paddingHorizontal: 4,
    textAlign: 'center',
  },

  // Checkbox
  checkBox: {
    width: 30,
    height: 30,
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
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    gap: spacing.lg,
  },
  addSetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addSetText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginLeft: 4,
  },
  notesToggle: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
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

  // Add exercise button
  addExerciseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    marginBottom: spacing.md,
  },
  addExerciseBtnText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },

  // Rest bar
  restBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  restBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  restBarLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  restBarTime: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  restBarInner: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceLight,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  restBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  restBarActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  restAdjustBtn: {
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  restAdjustText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  restSkipBtn: {
    backgroundColor: colors.primaryDim + '30',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  restSkipText: {
    color: colors.primaryLight,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },

  // No active workout
  noActiveContent: {
    padding: spacing.md,
    paddingTop: spacing.xl,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  heroTitle: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    marginTop: spacing.md,
  },
  heroSub: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },
  emptyBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  emptyBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  templateHeader: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  templateCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  templateCardLeft: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: colors.primaryDim,
  },
  templateCardBody: {
    flex: 1,
    padding: spacing.md,
  },
  templateName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  noTemplates: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },

  // Summary
  summaryContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  summaryStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryStatLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  summaryStatValue: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    width: '85%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.sm,
  },
  modalSub: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginBottom: spacing.lg,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  modalCancelBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  modalFinishBtn: {
    backgroundColor: colors.error,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
  },
  modalFinishText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },

  // Add exercise modal
  addExerciseModal: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: spacing.xxl,
  },
  addExerciseModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  addExerciseModalTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  addExerciseSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    margin: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  addExerciseSearchInput: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
  },
  addExerciseItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  addExerciseItemName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  addExerciseItemMeta: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },

  // Upcoming workout card
  upcomingCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  upcomingTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  upcomingSubtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
  },
  upcomingBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center' as const,
  },
  upcomingBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  // Target column
  colTarget: {
    width: 70,
    textAlign: 'center' as const,
  },
  targetCol: {
    color: colors.primaryLight,
    opacity: 0.5,
    fontSize: 12,
    textAlign: 'center' as const,
  },

  // Create exercise in modal
  createToggleInModal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    marginVertical: spacing.sm,
  },
  createToggleText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  createFormInModal: {
    maxHeight: 400,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  createLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  createInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: fontSize.md,
  },
  createErrorText: {
    color: colors.error,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  createChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  createChip: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  createChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  createChipText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  createChipTextSelected: {
    color: colors.white,
    fontWeight: fontWeight.semibold,
  },
  createSaveBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  createSaveBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
