import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout, modalStyles } from '../theme';
import { exerciseTypeColor } from '../utils/exerciseTypeColor';
import {
  getBestE1RM,
  getRecentExerciseHistory,
  updateExerciseFormNotes,
  updateExerciseMachineNotes,
} from '../services/database';
import { fireAndForgetSync } from '../services/sync';
import * as Sentry from '@sentry/react-native';
import ExerciseHistoryModal from './ExerciseHistoryModal';
import type { Exercise } from '../types/database';

interface Props {
  visible: boolean;
  exercise: Exercise | null;
  onClose: () => void;
  onExerciseUpdated?: (exercise: Exercise) => void;
}

interface RecentHistoryEntry {
  date: string;
  setCount: number;
  bestSet: string;
}

export default function ExerciseDetailModal({ visible, exercise, onClose, onExerciseUpdated }: Props) {
  const [loading, setLoading] = useState(false);
  const [bestE1RM, setBestE1RM] = useState<number | null>(null);
  const [recentHistory, setRecentHistory] = useState<RecentHistoryEntry[]>([]);
  const [formNotes, setFormNotes] = useState('');
  const [machineNotes, setMachineNotes] = useState('');
  const [showFullHistory, setShowFullHistory] = useState(false);

  const formNotesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const machineNotesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFormNotesRef = useRef<string | null>(null);
  const pendingMachineNotesRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible || !exercise) return;
    setFormNotes(exercise.form_notes ?? '');
    setMachineNotes(exercise.machine_notes ?? '');
    loadData(exercise.id);
  }, [visible, exercise?.id]);

  // Flush pending writes on unmount or close
  useEffect(() => {
    return () => {
      flushPending();
    };
  }, []);

  async function loadData(exerciseId: string) {
    setLoading(true);
    try {
      const [e1rm, history] = await Promise.all([
        getBestE1RM(exerciseId),
        getRecentExerciseHistory(exerciseId, 3),
      ]);
      setBestE1RM(e1rm);
      setRecentHistory(history);
    } catch (e) {
      Sentry.captureException(e);
    } finally {
      setLoading(false);
    }
  }

  async function flushPending() {
    if (formNotesTimerRef.current) {
      clearTimeout(formNotesTimerRef.current);
      formNotesTimerRef.current = null;
    }
    if (machineNotesTimerRef.current) {
      clearTimeout(machineNotesTimerRef.current);
      machineNotesTimerRef.current = null;
    }
    const promises: Promise<void>[] = [];
    if (pendingFormNotesRef.current !== null && exercise) {
      promises.push(updateExerciseFormNotes(exercise.id, pendingFormNotesRef.current || null));
      pendingFormNotesRef.current = null;
    }
    if (pendingMachineNotesRef.current !== null && exercise) {
      promises.push(updateExerciseMachineNotes(exercise.id, pendingMachineNotesRef.current || null));
      pendingMachineNotesRef.current = null;
    }
    if (promises.length > 0) {
      await Promise.allSettled(promises);
      fireAndForgetSync();
    }
  }

  const handleFormNotesChange = useCallback((text: string) => {
    setFormNotes(text);
    pendingFormNotesRef.current = text;
    if (formNotesTimerRef.current) clearTimeout(formNotesTimerRef.current);
    formNotesTimerRef.current = setTimeout(() => {
      if (!exercise) return;
      updateExerciseFormNotes(exercise.id, text || null);
      fireAndForgetSync();
      pendingFormNotesRef.current = null;
      if (onExerciseUpdated) {
        onExerciseUpdated({ ...exercise, form_notes: text || null });
      }
    }, 500);
  }, [exercise, onExerciseUpdated]);

  const handleMachineNotesChange = useCallback((text: string) => {
    setMachineNotes(text);
    pendingMachineNotesRef.current = text;
    if (machineNotesTimerRef.current) clearTimeout(machineNotesTimerRef.current);
    machineNotesTimerRef.current = setTimeout(() => {
      if (!exercise) return;
      updateExerciseMachineNotes(exercise.id, text || null);
      fireAndForgetSync();
      pendingMachineNotesRef.current = null;
      if (onExerciseUpdated) {
        onExerciseUpdated({ ...exercise, machine_notes: text || null });
      }
    }, 500);
  }, [exercise, onExerciseUpdated]);

  const handleClose = useCallback(async () => {
    await flushPending();
    onClose();
  }, [exercise, onClose]);

  if (!exercise) return null;

  const typeColor = exerciseTypeColor(exercise.type);

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
        <View style={styles.overlay}>
          <View style={[modalStyles.card, styles.container]}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerInfo}>
                <Text style={styles.exerciseName}>{exercise.name}</Text>
                <View style={styles.badgeRow}>
                  <View style={[styles.typeBadge, { backgroundColor: typeColor }]}>
                    <Text style={styles.typeBadgeText}>{exercise.type}</Text>
                  </View>
                  {exercise.muscle_groups.length > 0 && (
                    <Text style={styles.muscleText}>
                      {exercise.muscle_groups.join(', ')}
                    </Text>
                  )}
                </View>
              </View>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
            ) : (
              <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* e1RM Banner */}
                {bestE1RM != null && bestE1RM > 0 && (
                  <View style={styles.e1rmBanner}>
                    <Ionicons name="trophy" size={18} color={colors.warning} />
                    <Text style={styles.e1rmLabel}>Est. 1RM</Text>
                    <Text style={styles.e1rmValue}>{Math.round(bestE1RM)} lb</Text>
                  </View>
                )}

                {/* Form Notes */}
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Form Notes</Text>
                    <View style={styles.syncBadge}>
                      <Ionicons name="sync-outline" size={10} color={colors.primary} />
                      <Text style={styles.syncBadgeText}>Synced with coach</Text>
                    </View>
                  </View>
                  <TextInput
                    style={styles.notesInput}
                    multiline
                    value={formNotes}
                    onChangeText={handleFormNotesChange}
                    placeholder="Grip width, foot position, cues..."
                    placeholderTextColor={colors.textMuted}
                    testID="form-notes-input"
                  />
                </View>

                {/* Machine Notes */}
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Machine Settings</Text>
                    <View style={styles.privateBadge}>
                      <Ionicons name="lock-closed" size={10} color={colors.textMuted} />
                      <Text style={styles.privateBadgeText}>Private</Text>
                    </View>
                  </View>
                  <TextInput
                    style={styles.notesInput}
                    multiline
                    value={machineNotes}
                    onChangeText={handleMachineNotesChange}
                    placeholder="Seat position, attachments, pin settings..."
                    placeholderTextColor={colors.textMuted}
                    testID="machine-notes-input"
                  />
                </View>

                {/* Recent History */}
                {recentHistory.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Recent History</Text>
                    {recentHistory.map((entry, i) => {
                      const d = new Date(entry.date);
                      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      return (
                        <View key={i} style={styles.historyRow}>
                          <Text style={styles.historyDate}>{dateStr}</Text>
                          <Text style={styles.historySets}>{entry.setCount} sets</Text>
                          <Text style={styles.historyBest}>{entry.bestSet}</Text>
                        </View>
                      );
                    })}
                    <TouchableOpacity
                      style={styles.seeAllBtn}
                      onPress={() => setShowFullHistory(true)}
                    >
                      <Text style={styles.seeAllText}>See all</Text>
                      <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                )}

                <View style={{ height: spacing.xl }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Nested ExerciseHistoryModal */}
      {showFullHistory && (
        <ExerciseHistoryModal
          visible
          exercise={exercise}
          onClose={() => setShowFullHistory(false)}
        />
      )}
    </>
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
    alignItems: 'flex-start',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  exerciseName: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  typeBadge: {
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  typeBadgeText: {
    color: colors.white,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    textTransform: 'capitalize',
  },
  muscleText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  closeButton: {
    minWidth: layout.touchMin,
    minHeight: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: spacing.lg,
  },
  e1rmBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  e1rmLabel: {
    color: colors.warning,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    flex: 1,
  },
  e1rmValue: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  section: {
    marginTop: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  syncBadgeText: {
    color: colors.primary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  privateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  privateBadgeText: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  notesInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.sm,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  historyDate: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    width: 60,
  },
  historySets: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    flex: 1,
  },
  historyBest: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.xxs,
  },
  seeAllText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
});
