import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-chart-kit';
import { colors, spacing, fontSize, fontWeight, borderRadius, modalStyles } from '../theme';
import { getExerciseHistory } from '../services/database';
import { calculateEstimated1RM } from '../utils/oneRepMax';
import { getSetTagLabel, getSetTagColor } from '../utils/setTagUtils';
import type { Exercise, SetTag } from '../types/database';

interface Props {
  visible: boolean;
  exercise: Exercise | null;
  onClose: () => void;
}

interface DataPoint {
  date: string;
  best1RM: number;
}

interface VolumePoint {
  date: string;
  volume: number;
}

interface RecentSession {
  date: string;
  sets: { weight: number; reps: number; tag: SetTag; rpe: number | null; set_number: number }[];
}

export default function ExerciseHistoryModal({ visible, exercise, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<DataPoint[]>([]);
  const [volumeData, setVolumeData] = useState<VolumePoint[]>([]);
  const [prValue, setPrValue] = useState(0);
  const [prDateFormatted, setPrDateFormatted] = useState('');
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [isPlateaued, setIsPlateaued] = useState(false);

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
          const best = Math.max(...completedSets.map(s => calculateEstimated1RM(s.weight ?? 0, s.reps ?? 0, s.rpe)));
          const d = new Date(h.workout.started_at);
          return { date: `${d.getMonth() + 1}/${d.getDate()}`, best1RM: Math.round(best) };
        })
        .filter(Boolean)
        .reverse() as DataPoint[];

      setChartData(points);

      // Volume data: sum weight * reps for all completed sets per session
      const volPoints: VolumePoint[] = history
        .map((h) => {
          const completedSets = h.sets.filter(s => s.is_completed && s.weight && s.reps);
          if (completedSets.length === 0) return null;
          const volume = completedSets.reduce((sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0), 0);
          const d = new Date(h.workout.started_at);
          return { date: `${d.getMonth() + 1}/${d.getDate()}`, volume };
        })
        .filter(Boolean)
        .reverse() as VolumePoint[];

      setVolumeData(volPoints);

      // Plateau detection
      if (points.length >= 5) {
        const recentMax = Math.max(...points.slice(-5).map(p => p.best1RM));
        const fiveAgo = points[points.length - 5].best1RM;
        setIsPlateaued(recentMax <= fiveAgo);
      } else {
        setIsPlateaued(false);
      }

      if (points.length > 0) {
        let maxVal = 0;
        let maxDateFormatted = '';
        // Find PR from history to get full date for formatting
        for (let i = 0; i < history.length; i++) {
          const h = history[i];
          const completedSets = h.sets.filter(s => s.is_completed && s.weight && s.reps);
          if (completedSets.length === 0) continue;
          const best = Math.max(...completedSets.map(s => calculateEstimated1RM(s.weight ?? 0, s.reps ?? 0, s.rpe)));
          const rounded = Math.round(best);
          if (rounded >= maxVal) {
            maxVal = rounded;
            const d = new Date(h.workout.started_at);
            maxDateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }
        }
        setPrValue(maxVal);
        setPrDateFormatted(maxDateFormatted);
      } else {
        setPrValue(0);
        setPrDateFormatted('');
      }

      const recent = history.slice(0, 3).map(h => {
        const completedSets = h.sets
          .filter(s => s.is_completed && s.weight && s.reps)
          .sort((a, b) => a.set_number - b.set_number)
          .map(s => ({
            weight: s.weight!,
            reps: s.reps!,
            tag: s.tag,
            rpe: s.rpe,
            set_number: s.set_number,
          }));
        return {
          date: new Date(h.workout.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          sets: completedSets,
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
        <View style={[modalStyles.card, styles.container]}>
          <View style={styles.header}>
            <Text style={[modalStyles.title, styles.title]}>{exercise.name}</Text>
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

              {isPlateaued && chartData.length >= 5 && (
                <View style={styles.plateauBanner} testID="plateau-badge">
                  <Ionicons name="trending-down" size={16} color={colors.warning} />
                  <Text style={styles.plateauText}>Plateau — 1RM unchanged for 5 sessions</Text>
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

              {volumeData.length >= 3 && (
                <View style={styles.chartContainer}>
                  <Text style={styles.sectionTitle}>Volume Progression</Text>
                  <LineChart
                    data={{
                      labels: volumeData.length <= 8
                        ? volumeData.map(d => d.date)
                        : volumeData.filter((_, i) => i % Math.ceil(volumeData.length / 6) === 0 || i === volumeData.length - 1).map(d => d.date),
                      datasets: [{ data: volumeData.map(d => d.volume) }],
                    }}
                    width={screenWidth - spacing.md * 2}
                    height={180}
                    chartConfig={{
                      backgroundColor: colors.surface,
                      backgroundGradientFrom: colors.surface,
                      backgroundGradientTo: colors.surface,
                      decimalPlaces: 0,
                      color: (opacity = 1) => `rgba(82, 199, 124, ${opacity})`,
                      labelColor: () => colors.textMuted,
                      propsForDots: { r: '4', strokeWidth: '2', stroke: colors.success },
                    }}
                    bezier
                    style={{ borderRadius: borderRadius.md }}
                  />
                </View>
              )}

              {recentSessions.length > 0 && (
                <View style={styles.recentSection}>
                  <Text style={styles.sectionTitle}>Recent Performances</Text>
                  {recentSessions.map((session, i) => (
                    <View key={i} style={styles.sessionCard} testID={`session-row-${i}`}>
                      <Text style={styles.sessionDate} testID={`session-date-${i}`}>{session.date}</Text>
                      {session.sets.map((s, j) => (
                        <View key={j} style={styles.sessionSetRow}>
                          <Text style={styles.sessionSetNum}>{s.set_number}.</Text>
                          <Text style={styles.sessionSetDetail}>
                            {s.weight}lb × {s.reps}
                            {s.rpe != null ? ` @ RPE ${s.rpe}` : ''}
                          </Text>
                          {s.tag && s.tag !== 'working' && (
                            <View style={[styles.sessionTagBadge, { backgroundColor: getSetTagColor(s.tag) }]}>
                              <Text style={styles.sessionTagText}>{getSetTagLabel(s.tag)}</Text>
                            </View>
                          )}
                        </View>
                      ))}
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
    width: '100%',
    maxWidth: '100%',
    borderRadius: 0,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '85%',
    paddingBottom: spacing.xl,
    backgroundColor: colors.background,
    borderWidth: 0,
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
    flex: 1,
    marginBottom: 0,
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
    marginTop: spacing.xxs,
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
    textTransform: 'uppercase' as const,
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
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
  },
  sessionSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xxs,
  },
  sessionSetNum: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    width: 24,
  },
  sessionSetDetail: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
  sessionTagBadge: {
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  sessionTagText: {
    color: colors.white,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  plateauBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  plateauText: {
    color: colors.warning,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
});
