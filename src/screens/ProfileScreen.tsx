import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { getWorkoutHistory, getWorkoutSets } from '../services/database';

interface Stats {
  totalWorkouts: number;
  thisMonth: number;
  weekVolume: number;
  avgDuration: string;
  streak: number;
}

export default function ProfileScreen() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>({
    totalWorkouts: 0,
    thisMonth: 0,
    weekVolume: 0,
    avgDuration: '--',
    streak: 0,
  });
  const [loading, setLoading] = useState(true);

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

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  };

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
        <Text style={styles.subtitle}>{user?.email ?? 'Athlete'}</Text>
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

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
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
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  logoutText: {
    color: colors.error,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
});
