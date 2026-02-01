import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { getWorkoutHistory, getWorkoutSets } from '../services/database';

interface Stats {
  totalWorkouts: number;
  thisMonth: number;
  weekVolume: number;
  avgDuration: string;
  streak: number;
}

interface RestTimerSettings {
  strength: number;
  hypertrophy: number;
  endurance: number;
}

const DEFAULT_REST: RestTimerSettings = {
  strength: 180,
  hypertrophy: 90,
  endurance: 60,
};

export default function ProfileScreen() {
  const [stats, setStats] = useState<Stats>({
    totalWorkouts: 0,
    thisMonth: 0,
    weekVolume: 0,
    avgDuration: '--',
    streak: 0,
  });
  const [loading, setLoading] = useState(true);
  const [showRestModal, setShowRestModal] = useState(false);
  const [restSettings, setRestSettings] = useState<RestTimerSettings>(DEFAULT_REST);
  const [editingRest, setEditingRest] = useState<RestTimerSettings>(DEFAULT_REST);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          const history = await getWorkoutHistory();

          const now = new Date();
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const dayOfWeek = now.getDay();
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - dayOfWeek);
          weekStart.setHours(0, 0, 0, 0);

          const thisMonth = history.filter(
            (w) => new Date(w.started_at) >= monthStart,
          ).length;

          const weekWorkouts = history.filter(
            (w) => new Date(w.started_at) >= weekStart,
          );

          let weekVolume = 0;
          for (const w of weekWorkouts) {
            const sets = await getWorkoutSets(w.id);
            weekVolume += sets
              .filter((s) => s.is_completed)
              .reduce((sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0), 0);
          }

          // Calculate average duration
          let avgDuration = '--';
          const finishedWorkouts = history.filter(w => w.finished_at);
          if (finishedWorkouts.length > 0) {
            const totalMs = finishedWorkouts.reduce((sum, w) => {
              return sum + (new Date(w.finished_at!).getTime() - new Date(w.started_at).getTime());
            }, 0);
            const avgMin = Math.round(totalMs / finishedWorkouts.length / 60000);
            avgDuration = avgMin < 60 ? `${avgMin}m` : `${Math.floor(avgMin / 60)}h ${avgMin % 60}m`;
          }

          // Calculate streak (consecutive days with workouts)
          let streak = 0;
          if (history.length > 0) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dayMs = 86400000;
            let checkDate = today;

            // Check if there's a workout today or yesterday to start the streak
            const hasToday = history.some(w => {
              const d = new Date(w.started_at);
              d.setHours(0, 0, 0, 0);
              return d.getTime() === today.getTime();
            });
            const yesterday = new Date(today.getTime() - dayMs);
            const hasYesterday = history.some(w => {
              const d = new Date(w.started_at);
              d.setHours(0, 0, 0, 0);
              return d.getTime() === yesterday.getTime();
            });

            if (hasToday) {
              checkDate = today;
            } else if (hasYesterday) {
              checkDate = yesterday;
            }

            if (hasToday || hasYesterday) {
              let current = checkDate;
              while (true) {
                const hasWorkout = history.some(w => {
                  const d = new Date(w.started_at);
                  d.setHours(0, 0, 0, 0);
                  return d.getTime() === current.getTime();
                });
                if (hasWorkout) {
                  streak++;
                  current = new Date(current.getTime() - dayMs);
                } else {
                  break;
                }
              }
            }
          }

          if (!cancelled) {
            setStats({
              totalWorkouts: history.length,
              thisMonth,
              weekVolume,
              avgDuration,
              streak,
            });
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const handleSaveRest = () => {
    setRestSettings(editingRest);
    setShowRestModal(false);
  };

  const statCards: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
    { label: 'Total Workouts', value: `${stats.totalWorkouts}`, icon: 'fitness-outline', color: colors.primary },
    { label: 'This Month', value: `${stats.thisMonth}`, icon: 'calendar-outline', color: colors.success },
    {
      label: 'Week Volume',
      value:
        stats.weekVolume >= 1000
          ? `${(stats.weekVolume / 1000).toFixed(1)}k lb`
          : `${stats.weekVolume} lb`,
      icon: 'trending-up-outline',
      color: colors.warning,
    },
    { label: 'Avg Duration', value: stats.avgDuration, icon: 'time-outline', color: colors.accent },
    { label: 'Streak', value: stats.streak > 0 ? `${stats.streak} day${stats.streak > 1 ? 's' : ''}` : '—', icon: 'flame-outline', color: colors.error },
  ];

  const settingsRows: { label: string; icon: keyof typeof Ionicons.glyphMap; detail?: string; onPress?: () => void }[] = [
    {
      label: 'Rest Timer Defaults',
      icon: 'timer-outline',
      detail: `${restSettings.strength}s / ${restSettings.hypertrophy}s / ${restSettings.endurance}s`,
      onPress: () => { setEditingRest(restSettings); setShowRestModal(true); },
    },
    { label: 'Units', icon: 'scale-outline', detail: 'lb' },
    { label: 'Account', icon: 'person-circle-outline' },
  ];

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
      {/* Profile header */}
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={36} color={colors.textMuted} />
        </View>
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.subtitle}>Athlete</Text>
      </View>

      <View style={styles.statsGrid}>
        {statCards.map((card, i) => (
          <View key={i} style={styles.statCard}>
            <Ionicons name={card.icon} size={20} color={card.color} style={{ marginBottom: spacing.xs }} />
            <Text style={styles.statValue}>{card.value}</Text>
            <Text style={styles.statLabel}>{card.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>SETTINGS</Text>
      <View style={styles.settingsContainer}>
        {settingsRows.map((row, i) => (
          <TouchableOpacity
            key={i}
            style={[
              styles.settingsRow,
              i < settingsRows.length - 1 && styles.settingsRowBorder,
            ]}
            activeOpacity={0.6}
            onPress={row.onPress}
          >
            <Ionicons name={row.icon} size={20} color={colors.textSecondary} style={{ marginRight: spacing.md }} />
            <Text style={styles.settingsLabel}>{row.label}</Text>
            {row.detail && <Text style={styles.settingsDetail}>{row.detail}</Text>}
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Rest Timer Settings Modal */}
      <Modal visible={showRestModal} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowRestModal(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rest Timer Defaults</Text>
            <Text style={styles.modalSub}>Set default rest time (in seconds) for each training goal</Text>

            {(['strength', 'hypertrophy', 'endurance'] as const).map((goal) => (
              <View key={goal} style={styles.restInputRow}>
                <Text style={styles.restInputLabel}>{goal.charAt(0).toUpperCase() + goal.slice(1)}</Text>
                <View style={styles.restInputGroup}>
                  <TouchableOpacity
                    style={styles.restAdjBtn}
                    onPress={() => setEditingRest(prev => ({ ...prev, [goal]: Math.max(15, prev[goal] - 15) }))}
                  >
                    <Ionicons name="remove" size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.restInputValue}>{editingRest[goal]}s</Text>
                  <TouchableOpacity
                    style={styles.restAdjBtn}
                    onPress={() => setEditingRest(prev => ({ ...prev, [goal]: prev[goal] + 15 }))}
                  >
                    <Ionicons name="add" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setShowRestModal(false)} style={styles.modalCancelBtn}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSaveRest} style={styles.modalSaveBtn}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      </ScrollView>
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
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
  profileHeader: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xxs,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  statCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    width: '48%' as any,
    flexGrow: 1,
    alignItems: 'center',
  },
  statValue: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
  },
  statLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  settingsContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  settingsRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingsLabel: {
    color: colors.text,
    fontSize: fontSize.md,
    flex: 1,
  },
  settingsDetail: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginRight: spacing.sm,
  },

  // Modal
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
    maxWidth: 360,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.xs,
  },
  modalSub: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.lg,
  },
  restInputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  restInputLabel: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  restInputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  restAdjBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restInputValue: {
    color: colors.primaryLight,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    minWidth: 48,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
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
  modalSaveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
  },
  modalSaveText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
