import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout } from '../theme';
import { formatLastPerformed } from '../utils/formatLastPerformed';
import type { Template } from '../types/database';
import type { getUpcomingWorkoutForToday } from '../services/database';

type Props = {
  templates: Template[];
  upcomingWorkout: Awaited<ReturnType<typeof getUpcomingWorkoutForToday>>;
  onStartTemplate: (t: Template) => void;
  onStartEmpty: () => void;
  onStartUpcoming: () => void;
  startingTemplateId: string | null;
  lastPerformed: Record<string, string>;
};

const NoActiveWorkout = React.memo(function NoActiveWorkout({
  templates,
  upcomingWorkout,
  onStartTemplate,
  onStartEmpty,
  onStartUpcoming,
  startingTemplateId,
  lastPerformed,
}: Props) {
  const upcomingTemplateName = useMemo(() => {
    if (!upcomingWorkout?.workout.template_id) return null;
    return templates.find(t => t.id === upcomingWorkout.workout.template_id)?.name ?? null;
  }, [upcomingWorkout, templates]);

  const totalSets = useMemo(() => {
    if (!upcomingWorkout) return 0;
    return upcomingWorkout.exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
  }, [upcomingWorkout]);

  const noteLines = useMemo(() => {
    const raw = upcomingWorkout?.workout.notes;
    if (!raw) return [];
    return raw.split('\n').map(l => l.trim()).filter(Boolean);
  }, [upcomingWorkout]);

  const hasNotes = noteLines.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.noActiveContent}>
        {upcomingWorkout ? (
          <TouchableOpacity style={styles.upcomingCard} onPress={onStartUpcoming} testID="start-upcoming-workout">
            <View style={styles.upcomingCardHeader}>
              <View style={{ flex: 1 }}>
                {hasNotes && (
                  <Text style={styles.upcomingEyebrow}>✨ COACH PLANNED</Text>
                )}
                <Text style={styles.upcomingCardTitle}>
                  {upcomingTemplateName ?? 'Upcoming Workout'}
                </Text>
                <Text style={styles.upcomingCardMeta}>
                  {upcomingWorkout.exercises.length} exercises · {totalSets} sets
                </Text>
              </View>
              <View style={styles.upcomingGoBtn}>
                <Ionicons name="arrow-forward" size={22} color={colors.white} />
              </View>
            </View>
            {hasNotes && (
              <>
                <View style={styles.upcomingDivider} />
                {noteLines.map((line, i) => (
                  <View key={i} style={styles.upcomingNoteRow}>
                    <Text style={styles.upcomingNoteBullet}>•</Text>
                    <Text style={styles.upcomingNoteText}>{line}</Text>
                  </View>
                ))}
              </>
            )}
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.emptyIconWrapper}>
              <Ionicons name="barbell-outline" size={48} color={colors.textMuted} />
            </View>
            <TouchableOpacity style={styles.emptyCard} onPress={onStartEmpty} testID="start-empty-workout">
              <Ionicons name="flash-outline" size={20} color={colors.primary} style={{ marginRight: spacing.sm }} />
              <Text style={styles.emptyCardText}>Start Empty Workout</Text>
            </TouchableOpacity>
          </>
        )}

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
                    {lastPerformed[t.id] && (
                      <Text style={styles.templateLastPerformed}>{formatLastPerformed(lastPerformed[t.id])}</Text>
                    )}
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

export default NoActiveWorkout;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  noActiveContent: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.xl,
  },
  emptyIconWrapper: {
    alignItems: 'center',
    marginBottom: spacing.md,
    marginTop: spacing.md,
  },
  emptyCard: {
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.primaryBorderSubtle,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  emptyCardText: {
    color: colors.text,
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
  templateLastPerformed: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  noTemplates: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  upcomingCard: {
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.primaryBorderSubtle,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  upcomingCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  upcomingEyebrow: {
    color: colors.primary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
  },
  upcomingCardTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  upcomingCardMeta: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  upcomingGoBtn: {
    width: layout.touchMin,
    height: layout.touchMin,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.primaryBorderSubtle,
    marginVertical: spacing.md,
  },
  upcomingNoteRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  upcomingNoteBullet: {
    color: colors.primary,
    fontSize: fontSize.sm,
  },
  upcomingNoteText: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * 1.5,
    flex: 1,
  },
});
