import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { TemplateUpdatePlan } from '../utils/setDiff';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout } from '../theme';

interface WorkoutSummaryProps {
  summaryStats: { exercises: number; sets: number; duration: string };
  templateUpdatePlan: TemplateUpdatePlan | null;
  templateChangeDescriptions: string[];
  onUpdateTemplate: () => void;
  onDismiss: () => void;
}

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

export default function WorkoutSummary({
  summaryStats,
  templateUpdatePlan,
  templateChangeDescriptions,
  onUpdateTemplate,
  onDismiss,
}: WorkoutSummaryProps) {
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
        {templateUpdatePlan && (
          <View style={styles.templateUpdateSection}>
            <Text style={styles.templateUpdateTitle}>Template Changes Detected</Text>
            <View style={styles.templateUpdateCard}>
              {templateChangeDescriptions.map((desc) => (
                <View key={desc} style={styles.templateChangeRow}>
                  <Ionicons
                    name={desc.includes('order') ? 'swap-vertical' : 'fitness'}
                    size={16}
                    color={colors.primary}
                    style={{ marginRight: spacing.sm }}
                  />
                  <Text style={styles.templateChangeText}>{desc}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity style={styles.updateTemplateBtn} onPress={onUpdateTemplate}>
              <Ionicons name="sync" size={18} color={colors.white} style={{ marginRight: spacing.sm }} />
              <Text style={styles.updateTemplateBtnText}>Update Template</Text>
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity style={styles.primaryBtn} onPress={onDismiss}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
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
  templateUpdateSection: {
    marginBottom: spacing.md,
  },
  templateUpdateTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.sm,
  },
  templateUpdateCard: {
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primaryBorderSubtle,
    marginBottom: spacing.md,
  },
  templateChangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  templateChangeText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    flex: 1,
  },
  updateTemplateBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.buttonHeightSm,
  },
  updateTemplateBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
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
});
