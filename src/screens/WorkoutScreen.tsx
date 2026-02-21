// WorkoutScreen - handles both idle and active workout states
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Vibration,
  Alert,
  LayoutAnimation,
  UIManager,
  Platform,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { useAnimatedStyle, SharedValue, interpolate, Extrapolation } from 'react-native-reanimated';
import { useFocusEffect } from '@react-navigation/native';
import * as Sentry from '@sentry/react-native';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout, modalStyles } from '../theme';
import { MUSCLE_GROUPS, EXERCISE_TYPE_OPTIONS, REST_SECONDS } from '../constants/exercise';
import { getSetTagLabel, getSetTagColor } from '../utils/setTagUtils';
import { filterExercises } from '../utils/exerciseSearch';
import { syncToSupabase, pullUpcomingWorkout, pullExercisesAndTemplates, pullWorkoutHistory } from '../services/sync';
import {
  startRestTimerActivity,
  adjustRestTimerActivity,
  stopRestTimerActivity,
  requestNotificationPermissions,
  getRestTimerRemainingSeconds,
} from '../services/liveActivity';
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
  updateExerciseNotes,
  getBulkExercises,
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

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const BACKGROUND_PULL_TIMEOUT_MS = 15000;

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
  rpe: string;
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
  restEnabled: boolean;
}

// ─── Main Component ───

export default function WorkoutScreen() {
  const [loading, setLoading] = useState(true);
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [startingTemplateId, setStartingTemplateId] = useState<string | null>(null);

  // Active workout state
  const [exerciseBlocks, setExerciseBlocks] = useState<ExerciseBlock[]>([]);
  const [elapsed, setElapsed] = useState('00:00');
  const [restSeconds, setRestSeconds] = useState(0);
  const [restTotal, setRestTotal] = useState(0);
  const [restExerciseName, setRestExerciseName] = useState('');
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryStats, setSummaryStats] = useState({ exercises: 0, sets: 0, duration: '' });
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
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({});
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [previewExercises, setPreviewExercises] = useState<TemplateExercise[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const hasLoadedOnce = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workoutRef = useRef<Workout | null>(null);
  const blocksRef = useRef<ExerciseBlock[]>([]);

  // Promise ref for background history pull (so workout start can await it)
  const historyPulledRef = useRef<Promise<void>>(Promise.resolve());

  // Notes debouncing
  const pendingNotesRef = useRef<Map<string, { notes: string; setId: string | null }>>(new Map());
  const notesTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Keep blocksRef in sync for stable callbacks
  blocksRef.current = exerciseBlocks;

  // ─── Check for active workout on focus ───

  useFocusEffect(
    useCallback(() => {
      loadState();
    }, []),
  );

  async function loadState() {
    if (!hasLoadedOnce.current) setLoading(true);
    let active: Workout | null = null;
    try {
      active = await getActiveWorkout();
      setActiveWorkout(active);
      workoutRef.current = active;

      if (active) {
        setTemplateName(active.template_name ?? null);
        await loadActiveWorkout(active);
        hasLoadedOnce.current = true;
        setLoading(false);
      } else {
        // Load templates immediately (fast, local only)
        const t = await getAllTemplates();
        setTemplates(t);

        // Show UI right away
        hasLoadedOnce.current = true;
        setLoading(false);

        // Load upcoming workout in background (slow, network)
        loadUpcomingWorkoutInBackground();
      }
    } catch (e: unknown) {
      console.error('Failed to load workout state', e);
      Sentry.captureException(e);
      if (active) {
        // Set active workout even though blocks failed to load, so user can cancel
        setActiveWorkout(active);
        workoutRef.current = active;
        setTemplateName(active.template_name ?? null);
        setExerciseBlocks([]);
        startElapsedTimer(active.started_at);
        Alert.alert('Error', 'Failed to load workout exercises. You can cancel this workout or try again.');
      }
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }

  async function loadUpcomingWorkoutInBackground() {
    // Start workout history pull in parallel (for PREV data)
    historyPulledRef.current = Promise.race([
      pullWorkoutHistory(),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), BACKGROUND_PULL_TIMEOUT_MS)),
    ]).catch((e) => {
      console.error('pullWorkoutHistory failed or timed out', e);
    });

    // Pull exercises & templates from Supabase (MCP changes)
    try {
      await Promise.race([
        pullExercisesAndTemplates(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), BACKGROUND_PULL_TIMEOUT_MS)),
      ]);
      // Reload templates since pull may have added/modified them
      const t = await getAllTemplates();
      setTemplates(t);
    } catch (e: unknown) {
      console.error('pullExercisesAndTemplates failed or timed out', e);
    }

    // Pull upcoming workout from Supabase
    try {
      await Promise.race([
        pullUpcomingWorkout(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), BACKGROUND_PULL_TIMEOUT_MS)),
      ]);
    } catch (e: unknown) {
      console.error('pullUpcomingWorkout failed or timed out', e);
    }

    const upcoming = await getUpcomingWorkoutForToday();
    setUpcomingWorkout(upcoming);
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
    const exercises = await getBulkExercises(exerciseOrder);
    const exerciseLookup = new Map(exercises.map(e => [e.id, e]));

    for (const exId of exerciseOrder) {
      const wSets = exerciseMap[exId];
      const exercise = exerciseLookup.get(exId);
      if (!exercise) continue;

      const lastTime = await formatLastTime(exId);
      const previousSets = await getPreviousSets(exId);
      const setNotes = wSets[0]?.notes;
      const restoredNotes = setNotes || exercise.notes || '';

      blocks.push({
        exercise,
        sets: wSets.map((s, idx) => ({
          id: s.id,
          exercise_id: s.exercise_id,
          set_number: s.set_number,
          weight: s.weight != null && s.weight > 0 ? String(s.weight) : '',
          reps: s.reps != null ? String(s.reps) : '',
          rpe: s.rpe != null ? String(s.rpe) : '',
          tag: s.tag,
          is_completed: s.is_completed,
          previous: previousSets[idx] ?? null,
        })),
        lastTime,
        notesExpanded: restoredNotes.length > 0,
        notes: restoredNotes,
        restSeconds: REST_SECONDS[exercise.training_goal],
        restEnabled: true,
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

    // Start Live Activity on lock screen
    startRestTimerActivity(total, exerciseName);

    restRef.current = setInterval(() => {
      setRestSeconds((prev) => {
        if (prev <= 1) {
          if (restRef.current) clearInterval(restRef.current);
          restRef.current = null;
          // Stop Live Activity when timer ends
          stopRestTimerActivity();
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

    // Update Live Activity countdown
    adjustRestTimerActivity(delta);
  }

  function dismissRest() {
    if (restRef.current) clearInterval(restRef.current);
    restRef.current = null;
    setRestSeconds(0);

    // Stop Live Activity + cancel notification
    stopRestTimerActivity();
  }

  // ─── Notes debouncing helpers ───

  function flushPendingNotes() {
    for (const timerId of notesTimerRef.current.values()) {
      clearTimeout(timerId);
    }
    notesTimerRef.current.clear();

    for (const [exerciseId, { notes, setId }] of pendingNotesRef.current.entries()) {
      updateExerciseNotes(exerciseId, notes || null);
      if (setId) {
        updateWorkoutSet(setId, { notes });
      }
    }
    pendingNotesRef.current.clear();
  }

  function clearPendingNotes() {
    for (const timerId of notesTimerRef.current.values()) {
      clearTimeout(timerId);
    }
    notesTimerRef.current.clear();
    pendingNotesRef.current.clear();
  }

  function debouncedSaveNotes(exerciseId: string, notes: string, setId: string | null) {
    pendingNotesRef.current.set(exerciseId, { notes, setId });

    const existing = notesTimerRef.current.get(exerciseId);
    if (existing) clearTimeout(existing);

    const timerId = setTimeout(() => {
      const pending = pendingNotesRef.current.get(exerciseId);
      if (pending) {
        updateExerciseNotes(exerciseId, pending.notes || null);
        if (pending.setId) {
          updateWorkoutSet(pending.setId, { notes: pending.notes });
        }
        pendingNotesRef.current.delete(exerciseId);
      }
      notesTimerRef.current.delete(exerciseId);
    }, 500);

    notesTimerRef.current.set(exerciseId, timerId);
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
        rpe: '',
        tag: 'working',
        is_completed: false,
        previous: previousSets[i - 1] ?? null,
      });
    }
    const lastTime = await formatLastTime(exercise.id);
    const stickyNotes = exercise.notes ?? '';
    return { exercise, sets, lastTime, notesExpanded: stickyNotes.length > 0, notes: stickyNotes, restSeconds: restSec ?? REST_SECONDS[exercise.training_goal], restEnabled: true };
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
      setStartingTemplateId(template.id);  // Show spinner on this card
      await historyPulledRef.current;  // Wait for PREV data to be available
      const workout = await startWorkout(template.id);
      const templateExercises = await getTemplateExercises(template.id);

      const blocks: ExerciseBlock[] = [];
      for (const te of templateExercises) {
        if (!te.exercise) continue;
        blocks.push(await buildExerciseBlock(workout.id, te.exercise, te.default_sets, te.rest_seconds));
      }

      activateWorkout(workout, blocks, template.name);
    } catch (e: unknown) {
      console.error('Failed to start workout', e);
      Alert.alert('Error', 'Failed to start workout. Please try again.');
    } finally {
      setStartingTemplateId(null);
    }
  }

  const handleTemplatePress = useCallback(async (template: Template) => {
    setPreviewTemplate(template);
    setLoadingPreview(true);
    try {
      const exercises = await getTemplateExercises(template.id);
      setPreviewExercises(exercises);
    } catch (e: unknown) {
      console.error('Failed to load template exercises:', e);
      setPreviewExercises([]);
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  async function handleStartEmpty() {
    try {
      setLoading(true);
      const workout = await startWorkout(null);
      activateWorkout(workout, []);
    } catch (e: unknown) {
      console.error('Failed to start empty workout', e);
      Alert.alert('Error', 'Failed to start workout. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleStartFromUpcoming() {
    if (!upcomingWorkout) return;
    try {
      setLoading(true);
      await historyPulledRef.current;  // Wait for PREV data to be available
      const workout = await startWorkout(upcomingWorkout.workout.template_id);
      const blocks: ExerciseBlock[] = [];

      for (const upEx of upcomingWorkout.exercises) {
        if (!upEx.exercise) continue;
        const setCount = Math.max((upEx.sets ?? []).length, 1);
        blocks.push(await buildExerciseBlock(workout.id, upEx.exercise, setCount, upEx.rest_seconds));
      }

      setUpcomingTargets(upcomingWorkout.exercises);
      activateWorkout(workout, blocks);
    } catch (e: unknown) {
      console.error('Failed to start upcoming workout', e);
      Alert.alert('Error', 'Failed to start workout. Please try again.');
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
    const stickyNotes = exercise.notes ?? '';
    const newBlock: ExerciseBlock = {
      exercise,
      sets: [{
        id: ws.id,
        exercise_id: exercise.id,
        set_number: 1,
        weight: '',
        reps: '',
        rpe: '',
        tag: 'working',
        is_completed: false,
        previous: previousSets[0] ?? null,
      }],
      lastTime,
      notesExpanded: stickyNotes.length > 0,
      notes: stickyNotes,
      restSeconds: REST_SECONDS[exercise.training_goal],
      restEnabled: true,
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

  const handleSetChange = useCallback(async (
    blockIdx: number,
    setIdx: number,
    field: 'weight' | 'reps' | 'rpe',
    value: string,
  ) => {
    const block = blocksRef.current[blockIdx];
    const set = block?.sets[setIdx];
    if (!set) return;

    setExerciseBlocks((prev) => {
      const next = [...prev];
      const updatedBlock = { ...next[blockIdx], sets: [...next[blockIdx].sets] };
      updatedBlock.sets[setIdx] = { ...updatedBlock.sets[setIdx], [field]: value };
      next[blockIdx] = updatedBlock;
      return next;
    });

    const numVal = value === '' ? null : Number(value);
    await updateWorkoutSet(set.id, { [field]: numVal });
  }, []);

  const handleCycleTag = useCallback(async (blockIdx: number, setIdx: number) => {
    const block = blocksRef.current[blockIdx];
    const set = block?.sets[setIdx];
    if (!set) return;

    const tags: SetTag[] = ['working', 'warmup', 'failure', 'drop'];
    const idx = tags.indexOf(set.tag);
    const newTag = tags[(idx + 1) % tags.length];

    setExerciseBlocks((prev) => {
      const next = [...prev];
      const updatedBlock = { ...next[blockIdx], sets: [...next[blockIdx].sets] };
      updatedBlock.sets[setIdx] = { ...updatedBlock.sets[setIdx], tag: newTag };
      next[blockIdx] = updatedBlock;
      return next;
    });

    await updateWorkoutSet(set.id, { tag: newTag });
  }, []);

  const handleToggleComplete = useCallback(async (blockIdx: number, setIdx: number) => {
    const block = blocksRef.current[blockIdx];
    const set = block?.sets[setIdx];
    if (!set || !block) return;

    // Capture timer data NOW, before state update (avoid stale closure)
    const { restEnabled, restSeconds: blockRestSeconds, exercise } = block;
    const exerciseName = exercise.name;

    // Validate when marking complete (not when unchecking)
    if (!set.is_completed && (!set.weight.trim() || !set.reps.trim())) {
      const errorKey = `${blockIdx}-${setIdx}`;
      setValidationErrors(prev => ({ ...prev, [errorKey]: true }));
      // Clear error after 2 seconds
      setTimeout(() => {
        setValidationErrors(prev => {
          const { [errorKey]: _, ...rest } = prev;
          return rest;
        });
      }, 2000);
      return;
    }

    const newCompleted = !set.is_completed;

    setExerciseBlocks((prev) => {
      const next = [...prev];
      const updatedBlock = { ...next[blockIdx], sets: [...next[blockIdx].sets] };
      updatedBlock.sets[setIdx] = { ...updatedBlock.sets[setIdx], is_completed: newCompleted };
      next[blockIdx] = updatedBlock;
      return next;
    });

    await updateWorkoutSet(set.id, {
      is_completed: newCompleted,
      weight: set.weight === '' ? null : Number(set.weight),
      reps: set.reps === '' ? null : Number(set.reps),
    });

    if (newCompleted) {
      // Haptic feedback
      try { Vibration.vibrate(50); } catch {}
      // Use captured values, not stale state
      if (restEnabled) {
        startRestTimer(blockRestSeconds, exerciseName);
      }
    }
  }, []);

  const handleAddSet = useCallback(async (blockIdx: number) => {
    const workout = workoutRef.current;
    if (!workout) return;

    const block = blocksRef.current[blockIdx];
    if (!block) return;

    const exerciseId = block.exercise.id;
    const newSetNumber = block.sets.length + 1;

    const previousSets = await getPreviousSets(exerciseId);
    const ws = await addWorkoutSet({
      workout_id: workout.id,
      exercise_id: exerciseId,
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
        exercise_id: exerciseId,
        set_number: newSetNumber,
        weight: '',
        reps: '',
        rpe: '',
        tag: 'working',
        is_completed: false,
        previous: previousSets[newSetNumber - 1] ?? null,
      });
      next[blockIdx] = b;
      return next;
    });
  }, []);

  const handleDeleteSet = useCallback(async (blockIdx: number, setIdx: number) => {
    const block = blocksRef.current[blockIdx];
    const set = block?.sets[setIdx];
    if (!set) return;

    // Don't allow deleting the last set
    if (block.sets.length <= 1) return;

    Vibration.vibrate(10);
    await deleteWorkoutSet(set.id);
    LayoutAnimation.configureNext({
      duration: 250,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
    setExerciseBlocks((prev) => {
      const next = [...prev];
      const b = { ...next[blockIdx], sets: [...next[blockIdx].sets] };
      b.sets.splice(setIdx, 1);
      // Renumber
      b.sets.forEach((s, i) => { s.set_number = i + 1; });
      next[blockIdx] = b;
      return next;
    });
  }, []);

  const handleToggleNotes = useCallback((blockIdx: number) => {
    setExerciseBlocks((prev) => {
      const next = [...prev];
      next[blockIdx] = { ...next[blockIdx], notesExpanded: !next[blockIdx].notesExpanded };
      return next;
    });
  }, []);

  const handleRemoveExercise = useCallback(async (blockIdx: number) => {
    const block = blocksRef.current[blockIdx];
    if (!block) return;

    Alert.alert(
      `Remove ${block.exercise.name}?`,
      'This will delete all sets for this exercise.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            // Re-read from ref at onPress time for latest set IDs
            const currentBlock = blocksRef.current[blockIdx];
            const setsToDelete = currentBlock ? currentBlock.sets : block.sets;
            for (const set of setsToDelete) {
              await deleteWorkoutSet(set.id);
            }
            LayoutAnimation.configureNext({
              duration: 300,
              update: { type: LayoutAnimation.Types.easeInEaseOut },
              delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
            });
            setExerciseBlocks((prev) => prev.filter((_, idx) => idx !== blockIdx));
          },
        },
      ],
    );
  }, []);

  const handleToggleRestTimer = useCallback((blockIdx: number) => {
    setExerciseBlocks((prev) => {
      const next = [...prev];
      next[blockIdx] = { ...next[blockIdx], restEnabled: !next[blockIdx].restEnabled };
      return next;
    });
  }, []);

  const handleAdjustExerciseRest = useCallback((blockIdx: number, delta: number) => {
    setExerciseBlocks((prev) => {
      const next = [...prev];
      const newSeconds = Math.max(15, next[blockIdx].restSeconds + delta);
      // If adjusting, also ensure timer is enabled
      next[blockIdx] = { ...next[blockIdx], restSeconds: newSeconds, restEnabled: true };
      return next;
    });
  }, []);

  const handleNotesChange = useCallback((blockIdx: number, text: string) => {
    const block = blocksRef.current[blockIdx];
    if (!block) return;

    setExerciseBlocks((prev) => {
      const next = [...prev];
      next[blockIdx] = { ...next[blockIdx], notes: text };
      return next;
    });

    // Debounced persist to exercise (sticky notes) + first set
    const firstSet = block.sets[0];
    debouncedSaveNotes(block.exercise.id, text, firstSet?.id ?? null);
  }, []);

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
            clearPendingNotes();
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
    // Validate at least one set is completed
    const totalCompleted = exerciseBlocks.reduce(
      (sum, b) => sum + b.sets.filter(s => s.is_completed).length, 0
    );
    if (totalCompleted === 0) {
      Alert.alert('No Sets Completed', 'Complete at least one set before finishing.');
      return;
    }
    setShowFinishModal(true);
  }

  async function confirmFinish() {
    setShowFinishModal(false);
    const workout = workoutRef.current;
    if (!workout) return;

    // Flush any pending debounced notes before finishing
    flushPendingNotes();

    let totalSets = 0;
    let exerciseCount = exerciseBlocks.length;
    for (const block of exerciseBlocks) {
      for (const s of block.sets) {
        if (s.is_completed) {
          totalSets++;
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

  const handleCloseHistoryModal = useCallback(() => {
    setHistoryExercise(null);
  }, []);

  // ─── Notification permissions (one-time) ───

  useEffect(() => {
    requestNotificationPermissions();
  }, []);

  // ─── Resync rest timer on foreground return ───

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && restRef.current !== null) {
        const remaining = getRestTimerRemainingSeconds();
        if (remaining === null || remaining <= 0) {
          if (restRef.current) clearInterval(restRef.current);
          restRef.current = null;
          setRestSeconds(0);
          stopRestTimerActivity();
          try { Vibration.vibrate([0, 200, 100, 200]); } catch {}
        } else {
          setRestSeconds(remaining);
        }
      }
    });
    return () => subscription.remove();
  }, []);

  // ─── Cleanup ───

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (restRef.current) clearInterval(restRef.current);
      flushPendingNotes();
    };
  }, []);

  // ─── Memoized values ───

  const { completedSetsCount, totalSetsCount } = useMemo(() => ({
    completedSetsCount: exerciseBlocks.reduce((sum, b) => sum + b.sets.filter(s => s.is_completed).length, 0),
    totalSetsCount: exerciseBlocks.reduce((sum, b) => sum + b.sets.length, 0),
  }), [exerciseBlocks]);

  // ─── Render ───

  if (loading) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (showSummary) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.summaryContainer}>
          <Ionicons name="checkmark-circle" size={64} color={colors.success} style={{ alignSelf: 'center', marginBottom: spacing.md }} />
          <Text style={styles.summaryTitle}>Workout Complete!</Text>
          <View style={styles.summaryCard}>
            <SummaryStat label="Duration" value={summaryStats.duration} icon="time-outline" />
            <SummaryStat label="Exercises" value={String(summaryStats.exercises)} icon="barbell-outline" />
            <SummaryStat label="Sets" value={String(summaryStats.sets)} icon="layers-outline" />
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleDismissSummary}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!activeWorkout) {
    return (
      <>
        <NoActiveWorkout templates={templates} upcomingWorkout={upcomingWorkout} onStartTemplate={handleTemplatePress} onStartEmpty={handleStartEmpty} onStartUpcoming={handleStartFromUpcoming} startingTemplateId={startingTemplateId} />
        <Modal
          visible={!!previewTemplate}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewTemplate(null)}
        >
          <TouchableOpacity
            style={modalStyles.overlay}
            activeOpacity={1}
            onPress={() => setPreviewTemplate(null)}
          >
            <TouchableOpacity activeOpacity={1} style={[modalStyles.card, { maxHeight: '70%' }]}>
              <Text style={modalStyles.title}>{previewTemplate?.name}</Text>

              {loadingPreview ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />
              ) : (
                <FlatList
                  data={previewExercises}
                  keyExtractor={(item) => item.id}
                  style={{ marginVertical: spacing.md }}
                  renderItem={({ item, index }) => (
                    <View style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingVertical: spacing.sm,
                      borderBottomWidth: index < previewExercises.length - 1 ? 1 : 0,
                      borderBottomColor: colors.border,
                    }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontSize: fontSize.md }}>
                          {item.exercise?.name}
                        </Text>
                        <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>
                          {item.default_sets} sets · {item.exercise?.muscle_groups?.join(', ') || item.exercise?.type}
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
                  onPress={() => setPreviewTemplate(null)}
                >
                  <Text style={[modalStyles.cancelText, { color: colors.error }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[modalStyles.confirmBtn, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    if (previewTemplate) {
                      setPreviewTemplate(null);
                      handleStartFromTemplate(previewTemplate);
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
          <TouchableOpacity onPress={handleCancelWorkout} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }} testID="cancel-workout-btn">
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
          <ExerciseBlockItem
            key={`${block.exercise.id}-${blockIdx}`}
            block={block}
            blockIdx={blockIdx}
            upcomingTargets={upcomingTargets}
            validationErrors={validationErrors}
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
            onExercisePress={setHistoryExercise}
          />
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
      <Modal visible={showAddExercise} transparent animationType="slide" onRequestClose={() => setShowAddExercise(false)}>
        <View style={styles.addExerciseModal}>
          <View style={styles.addExerciseModalHeader}>
            <Text style={styles.addExerciseModalTitle}>Add Exercise</Text>
            <TouchableOpacity onPress={() => setShowAddExercise(false)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
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
                {EXERCISE_TYPE_OPTIONS.map((t) => (
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
            {filterExercises(availableExercises, exerciseSearch)
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
      <Modal visible={showFinishModal} transparent animationType="fade" onRequestClose={() => setShowFinishModal(false)}>
        <TouchableOpacity style={modalStyles.overlay} activeOpacity={1} onPress={() => setShowFinishModal(false)}>
          <TouchableOpacity activeOpacity={1} style={modalStyles.card}>
            <Text style={modalStyles.title}>Finish Workout</Text>
            <Text style={modalStyles.subtitle}>
              {completedSetsCount} of {totalSetsCount} sets completed. Finish this workout?
            </Text>
            <View style={[modalStyles.actions, { marginTop: 0 }]}>
              <TouchableOpacity onPress={() => setShowFinishModal(false)} style={modalStyles.cancelBtn}>
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmFinish} style={[modalStyles.confirmBtn, { backgroundColor: colors.error }]}>
                <Text style={modalStyles.confirmText}>Finish</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ExerciseHistoryModal
        visible={!!historyExercise}
        exercise={historyExercise}
        onClose={handleCloseHistoryModal}
      />
    </SafeAreaView>
  );
}

// ─── Sub-components ───

const NoActiveWorkout = React.memo(function NoActiveWorkout({
  templates,
  upcomingWorkout,
  onStartTemplate,
  onStartEmpty,
  onStartUpcoming,
  startingTemplateId,
}: {
  templates: Template[];
  upcomingWorkout: Awaited<ReturnType<typeof getUpcomingWorkoutForToday>>;
  onStartTemplate: (t: Template) => void;
  onStartEmpty: () => void;
  onStartUpcoming: () => void;
  startingTemplateId: string | null;
}) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.noActiveContent}>
        <View style={styles.heroSection}>
          <Ionicons name="barbell-outline" size={40} color={colors.primary} />
          <Text style={styles.heroTitle}>Start Workout</Text>
          <Text style={styles.heroSub}>Choose a template or start from scratch.</Text>
        </View>

        {upcomingWorkout && (
          <TouchableOpacity style={styles.upcomingCard} onPress={onStartUpcoming} testID="start-upcoming-workout">
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
            {templates.map((t) => {
              const isLoading = startingTemplateId === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.templateCard, isLoading && styles.templateCardDisabled]}
                  onPress={() => onStartTemplate(t)}
                  disabled={isLoading}
                  testID={`template-card-${t.id}`}
                >
                  <View style={styles.templateCardBody}>
                    <Text style={styles.templateName}>{t.name}</Text>
                  </View>
                  {isLoading ? (
                    <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: spacing.md }} />
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={{ marginRight: spacing.md }} />
                  )}
                </TouchableOpacity>
              );
            })}
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
});


const SummaryStat = React.memo(function SummaryStat({ label, value, icon }: { label: string; value: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.summaryStatRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {icon && <Ionicons name={icon} size={16} color={colors.textSecondary} style={{ marginRight: spacing.sm }} />}
        <Text style={styles.summaryStatLabel}>{label}</Text>
      </View>
      <Text style={styles.summaryStatValue}>{value}</Text>
    </View>
  );
});

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

interface ExerciseBlockItemProps {
  block: ExerciseBlock;
  blockIdx: number;
  upcomingTargets: (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] | null;
  validationErrors: Record<string, boolean>;
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
  validationErrors,
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
  return (
    <View style={styles.exerciseCard}>
      {/* Exercise header with name */}
      <View style={styles.exerciseHeaderRow}>
        <TouchableOpacity onPress={() => onExercisePress(block.exercise)} style={styles.exerciseNameContainer}>
          <Text style={styles.exerciseName}>{block.exercise.name}</Text>
        </TouchableOpacity>
      </View>

      {/* Set header row */}
      <View style={styles.setHeaderRow}>
        <Text style={[styles.setHeaderCell, styles.setNumCol]}>SET</Text>
        <Text style={[styles.setHeaderCell, styles.colPrev]}>PREV</Text>
        <Text style={[styles.setHeaderCell, styles.colFlex]}>LBS</Text>
        <Text style={[styles.setHeaderCell, styles.colFlex]}>REPS</Text>
        <Text style={[styles.setHeaderCell, styles.colRpe]}>RPE</Text>
        <Text style={[styles.setHeaderCell, styles.checkCol]} />
      </View>

      {/* Set rows */}
      {block.sets.map((set, setIdx) => {
        const tagLabel = getSetTagLabel(set.tag);
        const tagColor = getSetTagColor(set.tag);
        const prevText = set.previous
          ? `${set.previous.weight}×${set.previous.reps}`
          : '—';
        const hasError = validationErrors[`${blockIdx}-${setIdx}`];
        const target = upcomingTargets
          ?.find(e => e.exercise_id === block.exercise.id)
          ?.sets?.find(s => s.set_number === set.set_number);
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
              ]}
            >
              <TouchableOpacity
                style={styles.setNumCol}
                onPress={() => onCycleTag(blockIdx, setIdx)}
                onLongPress={() => onDeleteSet(blockIdx, setIdx)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
              <Text style={[styles.previousCol, styles.colPrev]} numberOfLines={1}>
                {prevText}
              </Text>
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
              <TextInput
                style={[styles.setInput, styles.colRpe]}
                keyboardType="numeric"
                value={set.rpe}
                onChangeText={(v) => onSetChange(blockIdx, setIdx, 'rpe', v)}
                placeholder={target?.target_rpe ? String(target.target_rpe) : '—'}
                placeholderTextColor={target?.target_rpe ? colors.primaryPlaceholder : colors.textMuted}
                testID={`rpe-${blockIdx}-${setIdx}`}
              />
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
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.headerRestBtnText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onToggleRestTimer(blockIdx)}
          testID={`rest-timer-toggle-${blockIdx}`}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
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
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
});

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
    borderBottomColor: colors.borderSubtle,
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
    paddingVertical: 10,
    borderRadius: borderRadius.full,
    minHeight: layout.touchMin,
    justifyContent: 'center',
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
    alignSelf: 'center' as const,
    width: '100%' as const,
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
    fontWeight: fontWeight.bold,
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
    textTransform: 'uppercase' as const,
  },
  setNumCol: { width: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  colPrev: { flex: 1.3, marginHorizontal: spacing.xs },
  colFlex: { flex: 1, marginHorizontal: spacing.xs },
  colRpe: { width: 40, marginHorizontal: spacing.xs },
  checkCol: { width: 44, alignItems: 'center' as const, marginLeft: spacing.xs },

  // Set row
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.xxs,
    borderRadius: borderRadius.md,
  },
  setRowCompleted: {
    backgroundColor: colors.successBg,
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
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  setNumBadgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: fontWeight.bold,
  },
  previousCol: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
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
    borderWidth: 1,
    borderColor: 'transparent',
  },
  setInputError: {
    borderColor: colors.error,
    backgroundColor: colors.errorBg,
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
    backgroundColor: colors.surfaceLight,
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
    paddingVertical: spacing.sm,
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
    paddingVertical: spacing.sm,
    minHeight: layout.buttonHeightSm,
    justifyContent: 'center',
    alignItems: 'center',
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
    minHeight: layout.buttonHeight,
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
    marginTop: layout.sectionGap,
  },
  templateCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  templateCardDisabled: {
    opacity: 0.7,
  },
  templateCardBody: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
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
    minHeight: layout.buttonHeight,
    justifyContent: 'center',
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
    marginTop: spacing.xxs,
  },

  // Upcoming workout card
  upcomingCard: {
    backgroundColor: colors.primaryMuted,
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
