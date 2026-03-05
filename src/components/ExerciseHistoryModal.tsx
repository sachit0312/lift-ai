import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-chart-kit';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout, modalStyles } from '../theme';
import { getExerciseHistory, getCurrentE1RM } from '../services/database';
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

function thinLabels<T extends { date: string }>(items: T[]): string[] {
  if (items.length <= 8) return items.map(d => d.date);
  const step = Math.ceil(items.length / 6);
  return items.map((d, i) => (i % step === 0 || i === items.length - 1) ? d.date : '');
}

interface HistoryData {
  chartData: DataPoint[];
  volumeData: VolumePoint[];
  prValue: number;
  prDateFormatted: string;
  currentE1rm: number;
  recentSessions: RecentSession[];
  isPlateaued: boolean;
}

const EMPTY_DATA: HistoryData = {
  chartData: [],
  volumeData: [],
  prValue: 0,
  prDateFormatted: '',
  currentE1rm: 0,
  recentSessions: [],
  isPlateaued: false,
};


export default function ExerciseHistoryModal({ visible, exercise, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<HistoryData>(EMPTY_DATA);

  useEffect(() => {
    if (!visible || !exercise) return;
    loadData();
  }, [visible, exercise]);

  async function loadData() {
    if (!exercise) return;
    setLoading(true);
    try {
      const history = await getExerciseHistory(exercise.id, 20);

      function isCompletedWorkingSet(s: { is_completed: boolean | number; weight: number | null; reps: number | null; tag: string }): boolean {
        return !!(s.is_completed && s.weight && s.reps && s.tag !== 'warmup');
      }

      const pointsWithDate: { point: DataPoint; fullDate: Date }[] = history
        .map((h) => {
          const completedSets = h.sets.filter(isCompletedWorkingSet);
          if (completedSets.length === 0) return null;
          const estimates = completedSets.map(s => {
            const rpe = s.tag === 'failure' ? 10 : s.rpe;
            return calculateEstimated1RM(s.weight ?? 0, s.reps ?? 0, rpe);
          }).filter(v => isFinite(v) && v > 0);
          if (estimates.length === 0) return null;
          const best = Math.max(...estimates);
          const d = new Date(h.workout.started_at);
          return { point: { date: `${d.getMonth() + 1}/${d.getDate()}`, best1RM: Math.round(best) }, fullDate: d };
        })
        .filter(Boolean)
        .reverse() as { point: DataPoint; fullDate: Date }[];

      const chartData = pointsWithDate.map(p => p.point);

      // Volume data: sum weight * reps for all completed sets per session
      const volumeData: VolumePoint[] = history
        .map((h) => {
          const completedSets = h.sets.filter(isCompletedWorkingSet);
          if (completedSets.length === 0) return null;
          const volume = completedSets.reduce((sum, s) => {
            const v = (s.weight ?? 0) * (s.reps ?? 0);
            return sum + (isFinite(v) ? v : 0);
          }, 0);
          const d = new Date(h.workout.started_at);
          return { date: `${d.getMonth() + 1}/${d.getDate()}`, volume };
        })
        .filter(Boolean)
        .reverse() as VolumePoint[];

      // Plateau detection
      let isPlateaued = false;
      if (chartData.length >= 5) {
        const recentMax = Math.max(...chartData.slice(-5).map(p => p.best1RM));
        const fiveAgo = chartData[chartData.length - 5].best1RM;
        isPlateaued = recentMax <= fiveAgo;
      }

      let prValue = 0;
      let prDateFormatted = '';
      let currentE1rm = 0;
      if (pointsWithDate.length > 0) {
        let prEntry = pointsWithDate[0];
        for (let i = 1; i < pointsWithDate.length; i++) {
          if (pointsWithDate[i].point.best1RM > prEntry.point.best1RM) {
            prEntry = pointsWithDate[i];
          }
        }
        prValue = prEntry.point.best1RM;
        prDateFormatted = prEntry.fullDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        // Freshness-weighted "current" 1RM from canonical DB function
        const freshE1rm = await getCurrentE1RM(exercise.id);
        if (freshE1rm != null) currentE1rm = Math.round(freshE1rm);
      }

      const recentSessions = history.slice(0, 5).map(h => {
        const completedSets = h.sets
          .filter(isCompletedWorkingSet)
          .sort((a, b) => a.set_number - b.set_number)
          .map(s => ({
            weight: s.weight!,
            reps: s.reps!,
            tag: s.tag,
            rpe: s.rpe,
            set_number: s.set_number,
          }));
        if (completedSets.length === 0) return null;
        return {
          date: new Date(h.workout.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          sets: completedSets,
        };
      }).filter(Boolean).slice(0, 3) as RecentSession[];

      setData({ chartData, volumeData, prValue, prDateFormatted, currentE1rm, recentSessions, isPlateaued });
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
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
          ) : (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
              {data.prValue > 0 && data.chartData.length >= 3 && (
                <View style={styles.prBanner}>
                  <View style={styles.prHeader}>
                    <Ionicons name="trophy" size={20} color={colors.warning} />
                    <Text style={styles.prLabel}>Estimated 1RM</Text>
                  </View>
                  <View style={styles.prRow}>
                    <View style={styles.prStat}>
                      <Text style={styles.prValue}>{data.currentE1rm > 0 ? data.currentE1rm : data.prValue} lb</Text>
                      <Text style={styles.prSubtext}>Current</Text>
                    </View>
                    {data.currentE1rm > 0 && data.currentE1rm < data.prValue && (
                      <View style={styles.prStat}>
                        <Text style={[styles.prValue, styles.prAllTime]}>{data.prValue} lb</Text>
                        <Text style={styles.prSubtext}>All-time · {data.prDateFormatted}</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {data.isPlateaued && data.chartData.length >= 5 && (
                <View style={styles.plateauBanner} testID="plateau-badge">
                  <Ionicons name="trending-down" size={16} color={colors.warning} />
                  <Text style={styles.plateauText}>Plateau — 1RM unchanged for 5 sessions</Text>
                </View>
              )}

              {data.chartData.length >= 3 ? (
                <View style={styles.chartContainer}>
                  <Text style={styles.sectionTitle}>1RM Progression</Text>
                  <LineChart
                    data={{
                      labels: thinLabels(data.chartData),
                      datasets: [{ data: data.chartData.map(d => d.best1RM) }],
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
                  {data.chartData.length === 0
                    ? 'No workout data yet'
                    : `${3 - data.chartData.length} more session${3 - data.chartData.length === 1 ? '' : 's'} needed for chart`}
                </Text>
              )}

              {data.volumeData.length >= 3 && (
                <View style={styles.chartContainer}>
                  <Text style={styles.sectionTitle}>Volume Progression</Text>
                  <LineChart
                    data={{
                      labels: thinLabels(data.volumeData),
                      datasets: [{ data: data.volumeData.map(d => d.volume) }],
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

              {data.recentSessions.length > 0 && (
                <View style={styles.recentSection}>
                  <Text style={styles.sectionTitle}>Recent Performances</Text>
                  {data.recentSessions.map((session, i) => (
                    <View key={i} style={styles.sessionCard} testID={`session-row-${i}`}>
                      <Text style={styles.sessionDate} testID={`session-date-${i}`}>{session.date}</Text>
                      {session.sets.map((s, j) => (
                        <View key={j} style={styles.sessionSetRow}>
                          <Text style={styles.sessionSetNum}>{s.set_number}.</Text>
                          <Text style={styles.sessionSetDetail}>
                            {s.weight}lb × {s.reps}
                          </Text>
                          {s.rpe != null && s.tag !== 'failure' && (
                            <View style={[styles.sessionTagBadge, { backgroundColor: colors.info }]}>
                              <Text style={styles.sessionTagText}>{s.rpe}</Text>
                            </View>
                          )}
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
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  prValue: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
  },
  prRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginTop: spacing.xs,
  },
  prStat: {
    flex: 0,
  },
  prAllTime: {
    fontSize: fontSize.lg,
    color: colors.textMuted,
  },
  prSubtext: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: spacing.xxs,
  },
  chartContainer: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
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
