import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-chart-kit';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { getExerciseHistory } from '../services/database';
import { calculateEstimated1RM } from '../utils/oneRepMax';
import type { Exercise, WorkoutSet } from '../types/database';

interface Props {
  visible: boolean;
  exercise: Exercise | null;
  onClose: () => void;
}

interface DataPoint {
  date: string;
  best1RM: number;
}

export default function ExerciseHistoryModal({ visible, exercise, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<DataPoint[]>([]);
  const [prValue, setPrValue] = useState(0);
  const [prDate, setPrDate] = useState('');
  const [prDateFormatted, setPrDateFormatted] = useState('');
  const [recentSessions, setRecentSessions] = useState<{ date: string; bestSet: WorkoutSet | null }[]>([]);

  useEffect(() => {
    if (!visible || !exercise) return;
    loadData();
  }, [visible, exercise]);

  async function loadData() {
    if (!exercise) return;
    setLoading(true);
    try {
      const history = await getExerciseHistory(exercise.id, 20);

      const points: DataPoint[] = history
        .map((h) => {
          const completedSets = h.sets.filter(s => s.is_completed && s.weight && s.reps);
          if (completedSets.length === 0) return null;
          const best = Math.max(...completedSets.map(s => calculateEstimated1RM(s.weight ?? 0, s.reps ?? 0)));
          const d = new Date(h.workout.started_at);
          return { date: `${d.getMonth() + 1}/${d.getDate()}`, best1RM: Math.round(best) };
        })
        .filter(Boolean)
        .reverse() as DataPoint[];

      setChartData(points);

      if (points.length > 0) {
        let maxVal = 0;
        let maxDate = '';
        let maxDateFormatted = '';
        // Find PR from history to get full date for formatting
        for (let i = 0; i < history.length; i++) {
          const h = history[i];
          const completedSets = h.sets.filter(s => s.is_completed && s.weight && s.reps);
          if (completedSets.length === 0) continue;
          const best = Math.max(...completedSets.map(s => calculateEstimated1RM(s.weight ?? 0, s.reps ?? 0)));
          const rounded = Math.round(best);
          if (rounded >= maxVal) {
            maxVal = rounded;
            const d = new Date(h.workout.started_at);
            maxDate = `${d.getMonth() + 1}/${d.getDate()}`;
            maxDateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }
        }
        setPrValue(maxVal);
        setPrDate(maxDate);
        setPrDateFormatted(maxDateFormatted);
      } else {
        setPrValue(0);
        setPrDate('');
        setPrDateFormatted('');
      }

      const recent = history.slice(0, 3).map(h => {
        const completedSets = h.sets.filter(s => s.is_completed && s.weight && s.reps);
        // Find best set by estimated 1RM
        let bestSet: WorkoutSet | null = null;
        let best1RM = 0;
        for (const s of completedSets) {
          const e1rm = calculateEstimated1RM(s.weight ?? 0, s.reps ?? 0);
          if (e1rm > best1RM) {
            best1RM = e1rm;
            bestSet = s;
          }
        }
        return {
          date: new Date(h.workout.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          bestSet,
        };
      });
      setRecentSessions(recent);
    } finally {
      setLoading(false);
    }
  }

  if (!exercise) return null;

  const screenWidth = Dimensions.get('window').width - spacing.lg * 2;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>{exercise.name}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
          ) : (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
              {prValue > 0 && chartData.length >= 3 && (
                <View style={styles.prBanner}>
                  <View style={styles.prHeader}>
                    <Ionicons name="trophy" size={20} color={colors.warning} />
                    <Text style={styles.prLabel}>Personal Record</Text>
                  </View>
                  <Text style={styles.prValue}>{prValue} lb</Text>
                  <Text style={styles.prSubtext}>1RM · {prDateFormatted}</Text>
                </View>
              )}

              {chartData.length >= 3 ? (
                <View style={styles.chartContainer}>
                  <Text style={styles.sectionTitle}>1RM Progression</Text>
                  <LineChart
                    data={{
                      labels: chartData.length <= 8
                        ? chartData.map(d => d.date)
                        : chartData.filter((_, i) => i % Math.ceil(chartData.length / 6) === 0 || i === chartData.length - 1).map(d => d.date),
                      datasets: [{ data: chartData.map(d => d.best1RM) }],
                    }}
                    width={screenWidth - spacing.md * 2}
                    height={180}
                    chartConfig={{
                      backgroundColor: colors.surface,
                      backgroundGradientFrom: colors.surface,
                      backgroundGradientTo: colors.surface,
                      decimalPlaces: 0,
                      color: (opacity = 1) => `rgba(124, 92, 252, ${opacity})`,
                      labelColor: () => colors.textMuted,
                      propsForDots: { r: '4', strokeWidth: '2', stroke: colors.primaryLight },
                    }}
                    bezier
                    style={{ borderRadius: borderRadius.md }}
                  />
                </View>
              ) : (
                <Text style={styles.noData}>
                  {chartData.length === 0
                    ? 'No workout data yet'
                    : `${3 - chartData.length} more session${3 - chartData.length === 1 ? '' : 's'} needed for chart`}
                </Text>
              )}

              {recentSessions.length > 0 && (
                <View style={styles.recentSection}>
                  <Text style={styles.sectionTitle}>Recent Performances</Text>
                  {recentSessions.map((session, i) => (
                    <View key={i} style={styles.sessionCard}>
                      <Text style={styles.sessionDate}>{session.date}</Text>
                      {session.bestSet && (
                        <Text style={styles.sessionSet}>
                          Best: {session.bestSet.weight}lb × {session.bestSet.reps}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              <View style={{ height: spacing.xl }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '85%',
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    flex: 1,
  },
  body: {
    paddingHorizontal: spacing.lg,
  },
  prBanner: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  prHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  prLabel: {
    color: colors.warning,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  prValue: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
  },
  prSubtext: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  chartContainer: {
    marginTop: spacing.lg,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    textTransform: 'uppercase' as any,
  },
  noData: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  recentSection: {
    marginTop: spacing.lg,
  },
  sessionCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  sessionDate: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  sessionSet: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginLeft: spacing.sm,
    marginBottom: 2,
  },
});
