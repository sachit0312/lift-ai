import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout } from '../theme';
import { getWorkoutHistory, getWorkoutSets, getAllExercises } from '../services/database';
import { formatDuration, formatDate } from '../utils/format';
import { getSetTagLabel, getSetTagColor } from '../utils/setTagUtils';
import ExerciseHistoryModal from '../components/ExerciseHistoryModal';
import type { Workout, WorkoutSet, Exercise } from '../types/database';

interface WorkoutWithDuration extends Workout {
  duration: string;
}

interface GroupedSets {
  exerciseId: string;
  exerciseName: string;
  sets: WorkoutSet[];
}

export default function HistoryScreen() {
  const [workouts, setWorkouts] = useState<WorkoutWithDuration[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSets, setExpandedSets] = useState<GroupedSets[]>([]);
  const [loading, setLoading] = useState(true);
  const [exerciseMap, setExerciseMap] = useState<Record<string, Exercise>>({});
  const [historyModalExercise, setHistoryModalExercise] = useState<Exercise | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedOnce = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!hasLoadedOnce.current) setLoading(true);
        try {
          const [history, exercises] = await Promise.all([
            getWorkoutHistory(),
            getAllExercises(),
          ]);

          const map: Record<string, Exercise> = {};
          for (const e of exercises) map[e.id] = e;
          if (!cancelled) setExerciseMap(map);

          const enriched: WorkoutWithDuration[] = history.map((w) => ({
            ...w,
            duration: formatDuration(w.started_at, w.finished_at),
          }));
          if (!cancelled) setWorkouts(enriched);
        } finally {
          if (!cancelled) {
            hasLoadedOnce.current = true;
            setLoading(false);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [history, exercises] = await Promise.all([
        getWorkoutHistory(),
        getAllExercises(),
      ]);

      const map: Record<string, Exercise> = {};
      for (const e of exercises) map[e.id] = e;
      setExerciseMap(map);

      const enriched: WorkoutWithDuration[] = history.map((w) => ({
        ...w,
        duration: formatDuration(w.started_at, w.finished_at),
      }));
      setWorkouts(enriched);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleExpand = useCallback(
    async (workoutId: string) => {
      if (expandedId === workoutId) {
        setExpandedId(null);
        setExpandedSets([]);
        return;
      }
      const sets = (await getWorkoutSets(workoutId)).filter(s => s.is_completed);
      const grouped: Record<string, WorkoutSet[]> = {};
      const order: string[] = [];
      for (const s of sets) {
        if (!grouped[s.exercise_id]) {
          grouped[s.exercise_id] = [];
          order.push(s.exercise_id);
        }
        grouped[s.exercise_id].push(s);
      }
      setExpandedSets(
        order.map((eid) => ({
          exerciseId: eid,
          exerciseName: exerciseMap[eid]?.name ?? 'Unknown Exercise',
          sets: grouped[eid],
        })),
      );
      setExpandedId(workoutId);
    },
    [expandedId, exerciseMap],
  );

  const handleCloseHistoryModal = useCallback(() => {
    setHistoryModalExercise(null);
  }, []);

  const renderWorkout = useCallback(({ item }: { item: WorkoutWithDuration }) => {
    const isExpanded = expandedId === item.id;
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => handleExpand(item.id)}
      >
        <View style={styles.cardInner}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.workoutName}>
                {item.template_name || 'Free Workout'}
              </Text>
              <View style={styles.dateRow}>
                <Ionicons name="calendar-outline" size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />
                <Text style={styles.dateText}>{formatDate(item.started_at)}</Text>
              </View>
            </View>
            <View style={styles.statPills}>
              <View style={styles.pill}>
                <Ionicons name="time-outline" size={12} color={colors.primaryLight} />
                <Text style={styles.pillText}>{item.duration}</Text>
              </View>
            </View>
          </View>

          {isExpanded && expandedSets.length > 0 && (
            <View style={styles.expandedSection}>
              {expandedSets.map((group, gi) => (
                <View key={gi} style={styles.exerciseGroup}>
                  <TouchableOpacity onPress={() => {
                    const ex = exerciseMap[group.exerciseId];
                    if (ex) setHistoryModalExercise(ex);
                  }} style={{ paddingVertical: spacing.xs }}>
                    <Text style={styles.exerciseGroupName}>{group.exerciseName}</Text>
                  </TouchableOpacity>
                  {group.sets.map((s) => {
                    const tagLabel = getSetTagLabel(s.tag);
                    const tagColor = getSetTagColor(s.tag);
                    return (
                      <View key={s.id} style={styles.setRow}>
                        <View style={[styles.setDot, { backgroundColor: colors.success }]} />
                        <Text style={styles.setText}>
                          Set {s.set_number}: {s.weight ?? 0}lb × {s.reps ?? 0}{s.rpe != null ? ` @ RPE ${s.rpe}` : ''}
                        </Text>
                        {tagLabel && (
                          <View style={[styles.setTagBadge, { backgroundColor: tagColor }]}>
                            <Text style={styles.setTagBadgeText}>{tagLabel}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              ))}
              {item.ai_summary ? (
                <View style={styles.aiSummary}>
                  <Ionicons name="sparkles" size={12} color={colors.primaryLight} style={{ marginRight: 6 }} />
                  <Text style={styles.aiSummaryText}>{item.ai_summary}</Text>
                </View>
              ) : null}
            </View>
          )}

          <View style={styles.expandHint}>
            <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [expandedId, expandedSets, exerciseMap, handleExpand]);

  if (loading) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.titleSection}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.subtitle}>Your workout journey</Text>
      </View>
      <FlatList
        data={workouts}
        keyExtractor={(w) => w.id}
        renderItem={renderWorkout}
        contentContainerStyle={
          workouts.length === 0 ? styles.emptyContainer : styles.list
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="barbell-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No Workouts Yet</Text>
            <Text style={styles.emptySubtext}>
              Complete your first workout to see it here.
            </Text>
          </View>
        }
      />
      <ExerciseHistoryModal
        visible={!!historyModalExercise}
        exercise={historyModalExercise}
        onClose={handleCloseHistoryModal}
      />
    </SafeAreaView>
  );
}

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
  titleSection: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xxs,
  },
  list: {
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    marginBottom: layout.cardGap,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  cardInner: {
    flex: 1,
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  workoutName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  dateText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  statPills: {
    flexDirection: 'column',
    gap: spacing.xs,
    marginLeft: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    gap: spacing.xs,
  },
  pillText: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  expandedSection: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  exerciseGroup: {
    marginBottom: spacing.sm,
  },
  exerciseGroupName: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.sm,
    marginBottom: spacing.xs,
  },
  setDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginRight: spacing.sm,
  },
  setText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  setTagBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginLeft: spacing.sm,
  },
  setTagBadgeText: {
    color: colors.white,
    fontSize: 9,
    fontWeight: fontWeight.bold,
  },
  aiSummary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  aiSummaryText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 18,
    flex: 1,
    fontStyle: 'italic',
  },
  expandHint: {
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginTop: spacing.lg,
  },
  emptySubtext: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
