import { useState, useCallback, useEffect, useRef } from 'react';
import { Vibration, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Sentry from '@sentry/react-native';
import type { LocalSet, ExerciseBlock } from '../types/workout';
import { getExerciseHistoryData } from '../utils/exerciseHistory';
import type {
  Template,
  TemplateExercise,
  Workout,
  WorkoutSet,
  Exercise,
  SetTag,
  ExerciseType,
  UpcomingWorkoutExercise,
  UpcomingWorkoutSet,
} from '../types/database';
import { REST_SECONDS, DEFAULT_REST_SECONDS } from '../constants/exercise';
import { computeSetDiffs, buildTemplateUpdatePlan } from '../utils/setDiff';
import type { TemplateUpdatePlan } from '../utils/setDiff';
import {
  fireAndForgetSync,
  pushTemplateOrderToSupabase,
  pullUpcomingWorkout,
  pullExercisesAndTemplates,
  pullWorkoutHistory,
  deleteUpcomingWorkoutFromSupabase,
} from '../services/sync';
import {
  requestNotificationPermissions,
  startWorkoutActivity,
  stopWorkoutActivity,
} from '../services/liveActivity';
import { clearWidgetState } from '../services/workoutBridge';
import {
  getUpcomingWorkoutForToday,
  getUpcomingWorkoutById,
  getAllTemplates,
  getTemplateExercises,
  getActiveWorkout,
  startWorkout,
  finishWorkout,
  addWorkoutSet,
  getWorkoutSets,
  updateWorkoutSet,
  deleteWorkout,
  getAllExercises,
  createExercise,
  getBulkExercises,
  addWorkoutSetsBatch,
  getLastPerformedByTemplate,
  getBestE1RM,
  stampExerciseOrder,
  setPlannedExerciseIds,
  getPlannedExerciseIds,
  insertSkippedPlaceholderSets,
  applyWorkoutChangesToTemplate,
  updateWorkoutSessionNotes,
  clearLocalUpcomingWorkout,
  getUserExerciseNotes,
  getUserExerciseNotesBatch,
  updateWorkoutCoachNotes,
} from '../services/database';

const BACKGROUND_PULL_TIMEOUT_MS = 15000;

// ─── Types ───

export interface UseWorkoutLifecycleOptions {
  workoutRef: React.MutableRefObject<Workout | null>;
  setExerciseBlocks: React.Dispatch<React.SetStateAction<ExerciseBlock[]>>;
  exerciseBlocks: ExerciseBlock[];
  blocksRef: React.MutableRefObject<ExerciseBlock[]>;
  originalBestE1RMRef: React.MutableRefObject<Map<string, number | undefined>>;
  currentBestE1RMRef: React.MutableRefObject<Map<string, number | undefined>>;
  prSetIdsRef: React.MutableRefObject<Set<string>>;
  lastActiveBlockRef: React.MutableRefObject<number>;
  syncWidgetState: (blocks?: ExerciseBlock[], isResting?: boolean, restEnd?: number) => void;
  dismissRest: () => void;
  debouncedSaveNotes: (exerciseId: string, notes: string) => void;
  flushPendingNotes: () => Promise<void>;
  clearPendingNotes: () => void;
  flushPendingSetWrites: () => void;
  clearPendingSetWrites: () => void;
  startWorkoutActivity: (exerciseName: string, subtitle: string) => void;
}

export interface UseWorkoutLifecycleReturn {
  loading: boolean;
  activeWorkout: Workout | null;
  templateName: string | null;
  templates: Template[];
  startingTemplateId: string | null;
  upcomingWorkout: Awaited<ReturnType<typeof getUpcomingWorkoutForToday>>;
  upcomingTargets: (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] | null;
  upcomingTargetsRef: React.MutableRefObject<(UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] | null>;
  showFinishModal: boolean;
  setShowFinishModal: React.Dispatch<React.SetStateAction<boolean>>;
  showSummary: boolean;
  summaryStats: { exercises: number; sets: number; duration: string };
  templateUpdatePlan: TemplateUpdatePlan | null;
  templateChangeDescriptions: string[];
  workoutNotes: string;
  lastPerformed: Record<string, string>;
  previewTemplate: Template | null;
  setPreviewTemplate: React.Dispatch<React.SetStateAction<Template | null>>;
  previewExercises: TemplateExercise[];
  loadingPreview: boolean;
  showAddExercise: boolean;
  setShowAddExercise: React.Dispatch<React.SetStateAction<boolean>>;
  availableExercises: Exercise[];
  exerciseSearch: string;
  setExerciseSearch: React.Dispatch<React.SetStateAction<string>>;
  showCreateInWorkout: boolean;
  setShowCreateInWorkout: React.Dispatch<React.SetStateAction<boolean>>;
  newExName: string;
  setNewExName: React.Dispatch<React.SetStateAction<string>>;
  newExType: ExerciseType;
  setNewExType: React.Dispatch<React.SetStateAction<ExerciseType>>;
  newExMuscles: string[];
  setNewExMuscles: React.Dispatch<React.SetStateAction<string[]>>;
  newExDescription: string;
  setNewExDescription: React.Dispatch<React.SetStateAction<string>>;
  newExValidation: string;
  setNewExValidation: React.Dispatch<React.SetStateAction<string>>;
  historyExercise: Exercise | null;
  setHistoryExercise: React.Dispatch<React.SetStateAction<Exercise | null>>;
  sessionNotesDebounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  handleStartFromTemplate: (template: Template) => Promise<void>;
  handleTemplatePress: (template: Template) => Promise<void>;
  handleStartEmpty: () => Promise<void>;
  handleStartFromUpcoming: () => Promise<void>;
  handleOpenAddExercise: () => Promise<void>;
  handleAddExerciseToWorkout: (exercise: Exercise) => Promise<void>;
  handleCreateAndAddExercise: () => Promise<void>;
  handleCancelWorkout: () => void;
  handleFinish: () => void;
  confirmFinish: () => Promise<void>;
  handleUpdateTemplate: () => void;
  handleDismissSummary: () => void;
  handleSessionNotesChange: (text: string) => void;
  handleCloseHistoryModal: () => void;
}

// ─── Hook ───

export function useWorkoutLifecycle(options: UseWorkoutLifecycleOptions): UseWorkoutLifecycleReturn {
  const {
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
    startWorkoutActivity: startWorkoutActivityProp,
  } = options;

  // ─── State ───
  const [loading, setLoading] = useState(true);
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [startingTemplateId, setStartingTemplateId] = useState<string | null>(null);
  const [upcomingWorkout, setUpcomingWorkout] = useState<Awaited<ReturnType<typeof getUpcomingWorkoutForToday>>>(null);
  const [upcomingTargets, setUpcomingTargets] = useState<(UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] | null>(null);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryStats, setSummaryStats] = useState({ exercises: 0, sets: 0, duration: '' });
  const [templateUpdatePlan, setTemplateUpdatePlan] = useState<TemplateUpdatePlan | null>(null);
  const [templateChangeDescriptions, setTemplateChangeDescriptions] = useState<string[]>([]);
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [lastPerformed, setLastPerformed] = useState<Record<string, string>>({});
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [previewExercises, setPreviewExercises] = useState<TemplateExercise[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
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

  // ─── Refs ───
  const hasLoadedOnce = useRef(false);
  const historyPulledRef = useRef<Promise<void>>(Promise.resolve());
  const sessionNotesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upcomingTargetsRef = useRef<typeof upcomingTargets>(null);
  upcomingTargetsRef.current = upcomingTargets;
  // Mirror workoutNotes state so confirmFinish always reads the latest value
  // regardless of React's async state batching (same pattern as blocksRef).
  const workoutNotesRef = useRef('');
  workoutNotesRef.current = workoutNotes;

  // ─── Helpers ───

  async function buildExerciseBlock(
    workoutId: string,
    exercise: Exercise,
    setCount: number,
    restSec?: number,
    tagOverrides?: SetTag[],
    programmedOrder?: number | null,
  ): Promise<ExerciseBlock> {
    const tags: SetTag[] = Array.from({ length: setCount }, (_, i) => tagOverrides?.[i] ?? 'working');
    const exerciseOrderValue = programmedOrder != null ? programmedOrder + 1 : 0;
    const programmedOrderValue = programmedOrder != null ? programmedOrder + 1 : null;
    const setsToInsert = tags.map((tag, i) => ({
      workout_id: workoutId,
      exercise_id: exercise.id,
      set_number: i + 1,
      reps: null,
      weight: null,
      tag,
      rpe: null,
      is_completed: false,
      notes: null,
      exercise_order: exerciseOrderValue,
      programmed_order: programmedOrderValue,
    }));
    const [{ previousSets, lastTime }, bestE1RMRaw, inserted, userNotes] = await Promise.all([
      getExerciseHistoryData(exercise.id),
      getBestE1RM(exercise.id),
      addWorkoutSetsBatch(setsToInsert),
      getUserExerciseNotes(exercise.id),
    ]);
    const bestE1RM = bestE1RMRaw ?? undefined;
    originalBestE1RMRef.current.set(exercise.id, bestE1RM);
    currentBestE1RMRef.current.set(exercise.id, bestE1RM);
    const sets: LocalSet[] = inserted.map((ws, i) => ({
      id: ws.id,
      exercise_id: exercise.id,
      set_number: i + 1,
      weight: '',
      reps: '',
      rpe: '',
      tag: tags[i],
      is_completed: false,
      previous: previousSets[i] ?? null,
    }));
    const stickyNotes = userNotes?.machine_notes ?? '';
    return { exercise, sets, lastTime, machineNotesExpanded: stickyNotes.length > 0, machineNotes: stickyNotes, restSeconds: restSec ?? REST_SECONDS[exercise.training_goal] ?? DEFAULT_REST_SECONDS, restEnabled: true, bestE1RM };
  }

  function activateWorkout(workout: Workout, blocks: ExerciseBlock[], name: string | null = null) {
    setTemplateName(name);
    setActiveWorkout(workout);
    workoutRef.current = workout;
    setExerciseBlocks(blocks);
    setWorkoutNotes(workout.session_notes ?? '');

    const firstBlock = blocks[0];
    if (firstBlock) {
      startWorkoutActivityProp(firstBlock.exercise.name, `Set 1/${firstBlock.sets.length}`);
      syncWidgetState(blocks, false, 0);
    }
  }

  // ─── Focus effect ───

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
      const prevWorkoutId = workoutRef.current?.id;
      workoutRef.current = active;

      if (active) {
        setTemplateName(active.template_name ?? null);

        // FIX-4: If this workout is already loaded in memory (same ID), skip the
        // full loadActiveWorkout() which would overwrite in-flight debounced changes.
        // Only do a full load on first mount or after a fresh workout start.
        if (hasLoadedOnce.current && blocksRef.current.length > 0 && prevWorkoutId === active.id) {
          // Workout already loaded — just update auth state refs and bail out.
          // Background sync is intentionally skipped here to avoid the
          // setExerciseBlocks(blocks) call inside loadActiveWorkout clobbering
          // pending set-input changes that haven't been flushed to the DB yet.
          setLoading(false);
          return;
        }

        await loadActiveWorkout(active);
        hasLoadedOnce.current = true;
        setLoading(false);
      } else {
        const t = await getAllTemplates();
        setTemplates(t);

        if (t.length > 0) {
          const lp = await getLastPerformedByTemplate(t.map(tmpl => tmpl.id));
          setLastPerformed(lp);
        }

        hasLoadedOnce.current = true;
        setLoading(false);

        loadUpcomingWorkoutInBackground();
      }
    } catch (e: unknown) {
      if (__DEV__) console.error('Failed to load workout state', e);
      Sentry.captureException(e);
      if (active) {
        setActiveWorkout(active);
        workoutRef.current = active;
        setTemplateName(active.template_name ?? null);
        setExerciseBlocks([]);
        Alert.alert('Error', 'Failed to load workout exercises. You can cancel this workout or try again.');
      }
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }

  async function loadUpcomingWorkoutInBackground() {
    historyPulledRef.current = Promise.race([
      pullWorkoutHistory(),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), BACKGROUND_PULL_TIMEOUT_MS)),
    ]).catch((e) => {
      if (__DEV__) console.error('pullWorkoutHistory failed or timed out', e);
      Sentry.captureException(e);
    });

    try {
      await Promise.race([
        pullExercisesAndTemplates(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), BACKGROUND_PULL_TIMEOUT_MS)),
      ]);
      const t = await getAllTemplates();
      setTemplates(t);
    } catch (e: unknown) {
      if (__DEV__) console.error('pullExercisesAndTemplates failed or timed out', e);
      Sentry.captureException(e);
    }

    try {
      await Promise.race([
        pullUpcomingWorkout(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), BACKGROUND_PULL_TIMEOUT_MS)),
      ]);
    } catch (e: unknown) {
      if (__DEV__) console.error('pullUpcomingWorkout failed or timed out', e);
      Sentry.captureException(e);
    }

    const upcoming = await getUpcomingWorkoutForToday();
    setUpcomingWorkout(upcoming);
  }

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

    const notesMap = await getUserExerciseNotesBatch(exerciseOrder);

    const validExIds = exerciseOrder.filter(id => exerciseLookup.has(id));
    const [historyResults, e1rmResults] = await Promise.all([
      Promise.all(validExIds.map(id => getExerciseHistoryData(id))),
      Promise.all(validExIds.map(id => getBestE1RM(id))),
    ]);

    for (let i = 0; i < validExIds.length; i++) {
      const exId = validExIds[i];
      const wSets = exerciseMap[exId];
      const exercise = exerciseLookup.get(exId)!;
      const { lastTime, previousSets } = historyResults[i];
      const bestE1RM = e1rmResults[i] ?? undefined;
      originalBestE1RMRef.current.set(exId, bestE1RM);
      currentBestE1RMRef.current.set(exId, bestE1RM);
      const restoredNotes = notesMap.get(exId)?.machine_notes ?? '';

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
        machineNotesExpanded: restoredNotes.length > 0,
        machineNotes: restoredNotes,
        restSeconds: REST_SECONDS[exercise.training_goal] ?? DEFAULT_REST_SECONDS,
        restEnabled: true,
        bestE1RM,
      });
    }

    if (workout.template_id) {
      try {
        const templateExercises = await getTemplateExercises(workout.template_id);
        const teLookup = new Map(templateExercises.map(te => [te.exercise_id, te]));
        for (const block of blocks) {
          const te = teLookup.get(block.exercise.id);
          if (te) {
            block.originalWarmupSets = te.warmup_sets;
            block.originalWorkingSets = te.default_sets;
          }
        }
      } catch (e) {
        if (__DEV__) console.warn('Failed to restore template set counts:', e);
        Sentry.captureException(e);
      }
    }

    if (workout.upcoming_workout_id) {
      try {
        const upcoming = await getUpcomingWorkoutById(workout.upcoming_workout_id);
        if (upcoming) {
          setUpcomingTargets(upcoming.exercises);
          for (const block of blocks) {
            const upEx = upcoming.exercises.find(e => e.exercise_id === block.exercise.id);
            if (upEx?.rest_seconds) {
              block.restSeconds = upEx.rest_seconds;
            }
          }
        }
      } catch (e) {
        if (__DEV__) console.warn('Failed to restore upcoming targets:', e);
        Sentry.captureException(e);
      }
    }

    setExerciseBlocks(blocks);
    setWorkoutNotes(workout.session_notes ?? '');

    const firstIncomplete = blocks.find(b => b.sets.some(s => !s.is_completed));
    if (firstIncomplete) {
      const setIdx = firstIncomplete.sets.findIndex(s => !s.is_completed);
      const setNum = setIdx >= 0 ? firstIncomplete.sets[setIdx].set_number : 1;
      startWorkoutActivityProp(firstIncomplete.exercise.name, `Set ${setNum}/${firstIncomplete.sets.length}`);
    }
    syncWidgetState(blocks, false, 0);
  }

  // ─── Start workout handlers ───

  async function handleStartFromTemplate(template: Template) {
    try {
      setStartingTemplateId(template.id);
      await historyPulledRef.current;
      const workout = await startWorkout(template.id);
      const templateExercises = await getTemplateExercises(template.id);

      const blocks = await Promise.all(
        templateExercises
          .filter(te => te.exercise)
          .map(async (te, i) => {
            const totalSets = te.warmup_sets + te.default_sets;
            const tags: SetTag[] = [
              ...Array(te.warmup_sets).fill('warmup' as SetTag),
              ...Array(te.default_sets).fill('working' as SetTag),
            ];
            const block = await buildExerciseBlock(workout.id, te.exercise!, totalSets, te.rest_seconds, tags, i);
            block.originalWarmupSets = te.warmup_sets;
            block.originalWorkingSets = te.default_sets;
            return block;
          })
      );

      const plannedIds = templateExercises.filter(te => te.exercise).map(te => te.exercise_id);
      await setPlannedExerciseIds(workout.id, plannedIds);

      activateWorkout(workout, blocks, template.name);
    } catch (e: unknown) {
      if (__DEV__) console.error('Failed to start workout', e);
      Sentry.captureException(e);
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
      if (__DEV__) console.error('Failed to load template exercises:', e);
      Sentry.captureException(e);
      setPreviewExercises([]);
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  async function handleStartEmpty() {
    try {
      setLoading(true);
      const workout = await startWorkout(null);
      await setPlannedExerciseIds(workout.id, null);
      activateWorkout(workout, []);
    } catch (e: unknown) {
      if (__DEV__) console.error('Failed to start empty workout', e);
      Sentry.captureException(e);
      Alert.alert('Error', 'Failed to start workout. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleStartFromUpcoming() {
    if (!upcomingWorkout) return;
    try {
      setLoading(true);
      await historyPulledRef.current;
      const workout = await startWorkout(upcomingWorkout.workout.template_id, upcomingWorkout.workout.id);
      const plannedExercises = upcomingWorkout.exercises.filter(upEx => upEx.exercise);
      const blocks = await Promise.all(
        plannedExercises.map(async (upEx, i) => {
          const sets = upEx.sets ?? [];
          const setCount = Math.max(sets.length, 1);
          const tagOverrides: SetTag[] = sets.map(s => s.tag ?? 'working');
          return buildExerciseBlock(workout.id, upEx.exercise!, setCount, upEx.rest_seconds, tagOverrides, i);
        })
      );

      await setPlannedExerciseIds(workout.id, plannedExercises.map(upEx => upEx.exercise_id));

      if (upcomingWorkout.workout.template_id) {
        try {
          const templateExercises = await getTemplateExercises(upcomingWorkout.workout.template_id);
          const teLookup = new Map(templateExercises.map(te => [te.exercise_id, te]));
          for (const block of blocks) {
            const te = teLookup.get(block.exercise.id);
            if (te) {
              block.originalWarmupSets = te.warmup_sets;
              block.originalWorkingSets = te.default_sets;
            }
          }
        } catch (e) {
          if (__DEV__) console.warn('Failed to load template set counts:', e);
          Sentry.captureException(e);
        }
      }

      try {
        const targetUpdates: Promise<void>[] = [];
        for (const block of blocks) {
          const upEx = upcomingWorkout.exercises.find(e => e.exercise_id === block.exercise.id);
          if (!upEx?.sets) continue;
          for (const set of block.sets) {
            const target = upEx.sets.find(s => s.set_number === set.set_number);
            if (target) {
              targetUpdates.push(updateWorkoutSet(set.id, {
                target_weight: target.target_weight,
                target_reps: target.target_reps,
                target_rpe: target.target_rpe ?? null,
              }));
            }
          }
        }
        await Promise.all(targetUpdates);
      } catch (targetErr) {
        if (__DEV__) console.warn('Failed to persist target values:', targetErr);
        Sentry.captureException(targetErr);
      }

      // Persist coach notes from upcoming workout onto the workout row
      try {
        const coachNotes = upcomingWorkout.workout.notes ?? null;
        const exerciseCoachNotesMap: Record<string, string> = {};
        for (const upEx of upcomingWorkout.exercises) {
          if (upEx.notes) {
            exerciseCoachNotesMap[upEx.exercise_id] = upEx.notes;
          }
        }
        const exerciseCoachNotes = Object.keys(exerciseCoachNotesMap).length > 0
          ? JSON.stringify(exerciseCoachNotesMap)
          : null;
        await updateWorkoutCoachNotes(workout.id, coachNotes, exerciseCoachNotes);
      } catch (coachErr) {
        if (__DEV__) console.warn('Failed to persist coach notes:', coachErr);
        Sentry.captureException(coachErr);
      }

      setUpcomingTargets(upcomingWorkout.exercises);
      activateWorkout(workout, blocks);
    } catch (e: unknown) {
      if (__DEV__) console.error('Failed to start upcoming workout', e);
      Sentry.captureException(e);
      Alert.alert('Error', 'Failed to start workout. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Add exercise mid-workout ───

  async function handleOpenAddExercise() {
    try {
      const exercises = await getAllExercises();
      setAvailableExercises(exercises);
      setExerciseSearch('');
      setShowAddExercise(true);
    } catch (e) {
      if (__DEV__) console.error('Failed to load exercises for add exercise modal:', e);
      Sentry.captureException(e);
    }
  }

  async function handleAddExerciseToWorkout(exercise: Exercise) {
    const workout = workoutRef.current;
    if (!workout) return;

    setShowAddExercise(false);
    const { previousSets, lastTime } = await getExerciseHistoryData(exercise.id);
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
    const [userNotes, bestE1RMRaw] = await Promise.all([
      getUserExerciseNotes(exercise.id),
      getBestE1RM(exercise.id),
    ]);
    const stickyNotes = userNotes?.machine_notes ?? '';
    const bestE1RM = bestE1RMRaw ?? undefined;
    originalBestE1RMRef.current.set(exercise.id, bestE1RM);
    currentBestE1RMRef.current.set(exercise.id, bestE1RM);
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
      machineNotesExpanded: stickyNotes.length > 0,
      machineNotes: stickyNotes,
      restSeconds: REST_SECONDS[exercise.training_goal] ?? DEFAULT_REST_SECONDS,
      restEnabled: true,
      bestE1RM,
    };

    const wasEmpty = blocksRef.current.length === 0;
    setExerciseBlocks((prev) => [...prev, newBlock]);
    if (wasEmpty) {
      startWorkoutActivityProp(newBlock.exercise.name, `Set 1/${newBlock.sets.length}`);
    }
    syncWidgetState([...blocksRef.current, newBlock]);
  }

  async function handleCreateAndAddExercise() {
    if (!newExName.trim()) {
      setNewExValidation('Exercise name is required');
      return;
    }
    setNewExValidation('');
    try {
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
    } catch (e) {
      if (__DEV__) console.error('Failed to create and add exercise:', e);
      Sentry.captureException(e);
    }
  }

  // ─── Session notes ───

  const handleSessionNotesChange = useCallback((text: string) => {
    setWorkoutNotes(text);
    if (sessionNotesDebounceRef.current) clearTimeout(sessionNotesDebounceRef.current);
    sessionNotesDebounceRef.current = setTimeout(() => {
      const workout = workoutRef.current;
      if (workout) updateWorkoutSessionNotes(workout.id, text || null).catch(e => Sentry.captureException(e));
    }, 500);
  }, []);

  // Cleanup session notes debounce on unmount
  useEffect(() => {
    return () => {
      if (sessionNotesDebounceRef.current) clearTimeout(sessionNotesDebounceRef.current);
    };
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
            if (sessionNotesDebounceRef.current) {
              clearTimeout(sessionNotesDebounceRef.current);
              sessionNotesDebounceRef.current = null;
            }
            if (workout) {
              await deleteWorkout(workout.id);
            }
            clearPendingSetWrites();
            clearPendingNotes();
            dismissRest();
            stopWorkoutActivity();
            clearWidgetState();
            setActiveWorkout(null);
            workoutRef.current = null;
            setTemplateName(null);
            setExerciseBlocks([]);
            setUpcomingTargets(null);
            setWorkoutNotes('');
            prSetIdsRef.current = new Set();
            originalBestE1RMRef.current.clear();
            currentBestE1RMRef.current.clear();
            loadState();
          },
        },
      ],
    );
  }

  // ─── Finish workout ───

  function handleFinish() {
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

    // Flush any pending debounced writes before finishing
    flushPendingSetWrites();
    flushPendingNotes();

    // FIX-2: Use blocksRef.current instead of exerciseBlocks (React state) to
    // avoid a stale closure if sets were completed while the Finish modal was open.
    const currentBlocks = blocksRef.current;

    // FIX-3: Before stamping performed order, insert ghost rows for any planned
    // exercise that is missing from the current blocks (user removed it mid-workout
    // or never engaged with it). Ghosts carry programmed_order so the coach can
    // detect "planned but skipped" after finish.
    try {
      const plannedIds = await getPlannedExerciseIds(workout.id);
      if (plannedIds && plannedIds.length > 0) {
        const presentIds = new Set(currentBlocks.map(b => b.exercise.id));
        const skipped: Array<{ exercise_id: string; programmed_order: number }> = [];
        plannedIds.forEach((exerciseId, i) => {
          if (!presentIds.has(exerciseId)) {
            skipped.push({ exercise_id: exerciseId, programmed_order: i + 1 });
          }
        });
        if (skipped.length > 0) {
          await insertSkippedPlaceholderSets(workout.id, skipped);
        }
      }
    } catch (e) {
      if (__DEV__) console.warn('Failed to insert skipped placeholder sets:', e);
      Sentry.captureException(e);
    }

    const setOrderEntries: Array<{ id: string; order: number }> = [];
    currentBlocks.forEach((block, blockIdx) => {
      for (const set of block.sets) {
        setOrderEntries.push({ id: set.id, order: blockIdx + 1 });
      }
    });
    await stampExerciseOrder(workout.id, setOrderEntries);

    let totalSets = 0;
    let exerciseCount = currentBlocks.length;
    for (const block of currentBlocks) {
      for (const s of block.sets) {
        if (s.is_completed) {
          totalSets++;
        }
      }
    }

    const diff = Math.max(0, Math.floor((Date.now() - new Date(workout.started_at).getTime()) / 1000));
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    const durationStr = `${m}m ${s}s`;

    // FIX-1: Cancel the session notes debounce and flush the latest value using
    // workoutNotesRef.current (always up-to-date) rather than the workoutNotes
    // React state (which may lag due to async batching).
    if (sessionNotesDebounceRef.current) {
      clearTimeout(sessionNotesDebounceRef.current);
      sessionNotesDebounceRef.current = null;
    }

    const latestNotes = workoutNotesRef.current;
    await finishWorkout(workout.id, latestNotes || undefined);

    if (workout.upcoming_workout_id) {
      clearLocalUpcomingWorkout().catch(e => Sentry.captureException(e));
      await deleteUpcomingWorkoutFromSupabase(workout.upcoming_workout_id);
      setUpcomingWorkout(null);
    }

    fireAndForgetSync();

    dismissRest();
    stopWorkoutActivity();
    clearWidgetState();

    try { Vibration.vibrate([0, 100, 50, 100, 50, 200]); } catch {}

    let updatePlan: TemplateUpdatePlan | null = null;
    if (workout.template_id) {
      try {
        const templateExercises = await getTemplateExercises(workout.template_id);
        updatePlan = buildTemplateUpdatePlan(workout.template_id, currentBlocks, templateExercises);
        if (updatePlan) {
          const descriptions: string[] = [];
          const setDiffs = computeSetDiffs(currentBlocks);
          for (const diff of setDiffs) {
            const parts: string[] = [];
            const describeChange = (label: string, before: number, after: number): string | null => {
              const delta = after - before;
              if (delta === 0) return null;
              const noun = `${label} set${Math.abs(delta) !== 1 ? 's' : ''}`;
              return delta > 0 ? `added ${delta} ${noun}` : `removed ${Math.abs(delta)} ${noun}`;
            };
            const warmupChange = describeChange('warmup', diff.warmupBefore, diff.warmupAfter);
            const workingChange = describeChange('working', diff.workingBefore, diff.workingAfter);
            if (warmupChange) parts.push(warmupChange);
            if (workingChange) parts.push(workingChange);
            if (parts.length > 0) descriptions.push(`${diff.exerciseName}: ${parts.join(', ')}`);
          }
          if (updatePlan.reorderedTemplateExerciseIds) descriptions.push('Exercise order updated');
          setTemplateChangeDescriptions(descriptions);
        }
      } catch (e) {
        if (__DEV__) console.warn('Failed to compute template update plan:', e);
        Sentry.captureException(e);
        setTemplateChangeDescriptions([]);
      }
    }
    setTemplateUpdatePlan(updatePlan);

    setSummaryStats({
      exercises: exerciseCount,
      sets: totalSets,
      duration: durationStr,
    });
    setShowSummary(true);
  }

  function handleUpdateTemplate() {
    if (!templateUpdatePlan) return;
    Alert.alert(
      'Update Template?',
      'This will apply the detected changes to your template.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update',
          onPress: async () => {
            try {
              await applyWorkoutChangesToTemplate(templateUpdatePlan);
              fireAndForgetSync();
              if (templateUpdatePlan.reorderedTemplateExerciseIds) {
                pushTemplateOrderToSupabase(templateUpdatePlan.templateId).catch(e => Sentry.captureException(e));
              }
              setTemplateUpdatePlan(null);
              setTemplateChangeDescriptions([]);
            } catch (e) {
              if (__DEV__) console.error('Failed to update template:', e);
              Sentry.captureException(e);
              Alert.alert('Error', 'Failed to update template.');
            }
          },
        },
      ]
    );
  }

  function handleDismissSummary() {
    const dismiss = () => {
      setShowSummary(false);
      setActiveWorkout(null);
      workoutRef.current = null;
      setTemplateName(null);
      setExerciseBlocks([]);
      setUpcomingTargets(null);
      setWorkoutNotes('');
      prSetIdsRef.current = new Set();
      originalBestE1RMRef.current.clear();
      currentBestE1RMRef.current.clear();
      setTemplateUpdatePlan(null);
      setTemplateChangeDescriptions([]);
      loadState();
    };
    if (templateUpdatePlan) {
      Alert.alert(
        'Discard Template Changes?',
        "You have unapplied template changes. They won't be saved.",
        [
          { text: 'Go Back', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: dismiss },
        ]
      );
    } else {
      dismiss();
    }
  }

  const handleCloseHistoryModal = useCallback(() => {
    setHistoryExercise(null);
  }, []);

  // ─── Notification permissions (one-time) ───

  useEffect(() => {
    requestNotificationPermissions();
  }, []);

  // ─── Cleanup ───

  useEffect(() => {
    return () => {
      flushPendingNotes();
    };
  }, []);

  return {
    loading,
    activeWorkout,
    templateName,
    templates,
    startingTemplateId,
    upcomingWorkout,
    upcomingTargets,
    upcomingTargetsRef,
    showFinishModal,
    setShowFinishModal,
    showSummary,
    summaryStats,
    templateUpdatePlan,
    templateChangeDescriptions,
    workoutNotes,
    lastPerformed,
    previewTemplate,
    setPreviewTemplate,
    previewExercises,
    loadingPreview,
    showAddExercise,
    setShowAddExercise,
    availableExercises,
    exerciseSearch,
    setExerciseSearch,
    showCreateInWorkout,
    setShowCreateInWorkout,
    newExName,
    setNewExName,
    newExType,
    setNewExType,
    newExMuscles,
    setNewExMuscles,
    newExDescription,
    setNewExDescription,
    newExValidation,
    setNewExValidation,
    historyExercise,
    setHistoryExercise,
    sessionNotesDebounceRef,
    handleStartFromTemplate,
    handleTemplatePress,
    handleStartEmpty,
    handleStartFromUpcoming,
    handleOpenAddExercise,
    handleAddExerciseToWorkout,
    handleCreateAndAddExercise,
    handleCancelWorkout,
    handleFinish,
    confirmFinish,
    handleUpdateTemplate,
    handleDismissSummary,
    handleSessionNotesChange,
    handleCloseHistoryModal,
  };
}
