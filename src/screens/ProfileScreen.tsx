import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Modal,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, fontSize, fontWeight, borderRadius, modalStyles } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { supabase, deleteAccount } from '../services/supabase';
import { getWorkoutHistory, getPRsThisWeek } from '../services/database';

interface Stats {
  totalWorkouts: number;
  thisMonth: number;
  prsThisWeek: number;
  streak: number;
}

export default function ProfileScreen() {
  const { user, session } = useAuth();
  const [stats, setStats] = useState<Stats>({
    totalWorkouts: 0,
    thisMonth: 0,
    prsThisWeek: 0,
    streak: 0,
  });
  const [loading, setLoading] = useState(true);
  const [tokenModalVisible, setTokenModalVisible] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const hasLoadedOnce = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!hasLoadedOnce.current) setLoading(true);
        try {
          const history = await getWorkoutHistory();

          const now = new Date();
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

          const thisMonth = history.filter(
            (w) => new Date(w.started_at) >= monthStart,
          ).length;

          const prsThisWeek = await getPRsThisWeek();

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
              prsThisWeek,
              streak,
            });
          }
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

  const statCards = useMemo<{ label: string; value: string; icon: keyof typeof Ionicons.glyphMap; color: string }[]>(() => [
    { label: 'Total Workouts', value: `${stats.totalWorkouts}`, icon: 'fitness-outline', color: colors.primary },
    { label: 'This Month', value: `${stats.thisMonth}`, icon: 'calendar-outline', color: colors.success },
    { label: 'PRs This Week', value: `${stats.prsThisWeek}`, icon: 'trophy-outline', color: colors.warning },
    { label: 'Streak', value: stats.streak > 0 ? `${stats.streak} day${stats.streak > 1 ? 's' : ''}` : '—', icon: 'flame-outline', color: colors.error },
  ], [stats.totalWorkouts, stats.thisMonth, stats.prsThisWeek, stats.streak]);

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account?',
      'This will permanently delete your account and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'All your workout data will be permanently lost.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Delete My Account',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await deleteAccount();
                      await supabase.auth.signOut();
                    } catch (e: unknown) {
                      Alert.alert(
                        'Error',
                        e instanceof Error ? e.message : 'Failed to delete account. Please try again.',
                      );
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  const handleGetMCPToken = () => {
    setTokenCopied(false);
    setTokenModalVisible(true);
  };

  const handleCopyToken = async () => {
    if (session?.access_token) {
      await Clipboard.setStringAsync(session.access_token);
      setTokenCopied(true);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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

      <TouchableOpacity style={styles.mcpTokenButton} onPress={handleGetMCPToken} testID="mcp-token-btn">
        <Ionicons name="key-outline" size={20} color={colors.primary} />
        <Text style={styles.mcpTokenText}>Get MCP Token</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} testID="logout-btn">
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteAccountButton} onPress={handleDeleteAccount} testID="delete-account-btn">
        <Ionicons name="trash-outline" size={20} color={colors.error} />
        <Text style={styles.deleteAccountText}>Delete Account</Text>
      </TouchableOpacity>
      </ScrollView>

      {/* MCP Token Modal */}
      <Modal
        visible={tokenModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTokenModalVisible(false)}
      >
        <View style={[modalStyles.overlay, { padding: spacing.lg }]}>
          <View style={styles.modalContent}>
            <Text style={[modalStyles.title, { textAlign: 'center' }]}>MCP API Token</Text>
            <Text style={styles.modalDescription}>
              Use this token to connect Claude Desktop to your workout data.
              The token expires when you log out.
            </Text>

            <View style={styles.tokenBox}>
              <Text style={styles.tokenText} numberOfLines={3} ellipsizeMode="middle">
                {session?.access_token ?? 'No token available'}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.copyButton, tokenCopied && styles.copyButtonSuccess]}
              onPress={handleCopyToken}
            >
              <Ionicons
                name={tokenCopied ? 'checkmark' : 'copy-outline'}
                size={20}
                color={tokenCopied ? colors.success : colors.text}
              />
              <Text style={[styles.copyButtonText, tokenCopied && styles.copyButtonTextSuccess]}>
                {tokenCopied ? 'Copied!' : 'Copy Token'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.instructionsTitle}>Claude Desktop Setup:</Text>
            <Text style={styles.instructionsText}>
              1. Open ~/.claude/claude_desktop_config.json{'\n'}
              2. Add the MCP server config with this token{'\n'}
              3. Restart Claude Desktop
            </Text>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setTokenModalVisible(false)}
            >
              <Text style={styles.closeButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    width: '48%' as const,
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
  mcpTokenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginTop: spacing.lg,
  },
  mcpTokenText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
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
  deleteAccountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  deleteAccountText: {
    color: colors.error,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 400,
  },
  modalDescription: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  tokenBox: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  tokenText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  copyButtonSuccess: {
    backgroundColor: colors.success + '20',
  },
  copyButtonText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  copyButtonTextSuccess: {
    color: colors.success,
  },
  instructionsTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  instructionsText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  closeButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  closeButtonText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
