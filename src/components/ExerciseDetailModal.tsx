import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout, modalStyles } from '../theme';
import { exerciseTypeColor } from '../utils/exerciseTypeColor';
import {
  updateExerciseFormNotes,
  updateExerciseMachineNotes,
  getUserExerciseNotes,
} from '../services/database';
import { fireAndForgetSync } from '../services/sync';
// Lazy: ExerciseHistoryContent pulls react-native-chart-kit (+ react-native-svg).
// Loading at mount would parse those into every modal-opening tab. Defer until
// the user activates the History tab inside the modal.
const ExerciseHistoryContent = React.lazy(() => import('./ExerciseHistoryContent'));
import type { Exercise, ExerciseNotes, ExerciseWithNotes } from '../types/database';

interface Props {
  visible: boolean;
  exercise: Exercise | null;
  onClose: () => void;
  onExerciseUpdated?: (exercise: ExerciseWithNotes) => void;
}

export default function ExerciseDetailModal({ visible, exercise, onClose, onExerciseUpdated }: Props) {
  const [formNotes, setFormNotes] = useState('');
  const [machineNotes, setMachineNotes] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details');
  const [loadedNotes, setLoadedNotes] = useState<ExerciseNotes>({ form_notes: null, machine_notes: null });
  // True when the initial notes fetch failed. Inputs are stuck blank in that case, but
  // blank-because-load-failed must never be treated as blank-because-no-notes-saved-yet —
  // that would let a later edit silently overwrite real stored notes. So we disable
  // editing until the modal is reopened and the fetch succeeds.
  const [notesLoadError, setNotesLoadError] = useState(false);

  const formNotesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const machineNotesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFormNotesRef = useRef<string | null>(null);
  const pendingMachineNotesRef = useRef<string | null>(null);
  // Dedupe alerts across a run of debounced save failures (e.g. offline while typing) —
  // only the first failure since the last success surfaces an Alert.
  const formSaveFailedRef = useRef(false);
  const machineSaveFailedRef = useRef(false);
  // Refs to avoid stale closures in flush/debounce callbacks
  const exerciseRef = useRef(exercise);
  exerciseRef.current = exercise;
  const loadedNotesRef = useRef(loadedNotes);
  loadedNotesRef.current = loadedNotes;

  useEffect(() => {
    if (!visible || !exercise) return;
    setActiveTab('details');
    setNotesLoadError(false);
    getUserExerciseNotes(exercise.id).then(n => {
      const notes = n ?? { form_notes: null, machine_notes: null };
      setLoadedNotes(notes);
      setFormNotes(notes.form_notes ?? '');
      setMachineNotes(notes.machine_notes ?? '');
    }).catch(e => {
      if (__DEV__) console.error('getUserExerciseNotes failed', e);
      Sentry.captureException(e);
      // Fields stay blank, but flagged as "failed to load" (not "nothing saved") so
      // editing is disabled below rather than risking a save that wipes real notes.
      setNotesLoadError(true);
    });
  }, [visible, exercise?.id]);

  // Flush pending writes on unmount or close
  useEffect(() => {
    return () => {
      flushPending();
    };
  }, []);

  async function flushPending() {
    if (formNotesTimerRef.current) {
      clearTimeout(formNotesTimerRef.current);
      formNotesTimerRef.current = null;
    }
    if (machineNotesTimerRef.current) {
      clearTimeout(machineNotesTimerRef.current);
      machineNotesTimerRef.current = null;
    }
    const currentExercise = exerciseRef.current;
    const promises: Promise<void>[] = [];
    if (pendingFormNotesRef.current !== null && currentExercise) {
      promises.push(updateExerciseFormNotes(currentExercise.id, pendingFormNotesRef.current || null));
      pendingFormNotesRef.current = null;
    }
    if (pendingMachineNotesRef.current !== null && currentExercise) {
      promises.push(updateExerciseMachineNotes(currentExercise.id, pendingMachineNotesRef.current || null));
      pendingMachineNotesRef.current = null;
    }
    if (promises.length > 0) {
      const results = await Promise.allSettled(promises);
      results.forEach(r => {
        if (r.status === 'rejected') {
          if (__DEV__) console.error('flushPending note write failed', r.reason);
          Sentry.captureException(r.reason);
        }
      });
      fireAndForgetSync();
    }
  }

  const handleFormNotesChange = useCallback((text: string) => {
    setFormNotes(text);
    pendingFormNotesRef.current = text;
    if (formNotesTimerRef.current) clearTimeout(formNotesTimerRef.current);
    formNotesTimerRef.current = setTimeout(() => {
      const ex = exerciseRef.current;
      if (!ex) return;
      updateExerciseFormNotes(ex.id, text || null).then(() => {
        formSaveFailedRef.current = false;
      }).catch(e => {
        if (__DEV__) console.error('updateExerciseFormNotes failed', e);
        Sentry.captureException(e);
        // Debounced, so a flaky connection could fail on every keystroke — only
        // alert once per run of failures, not on every save attempt.
        if (!formSaveFailedRef.current) {
          formSaveFailedRef.current = true;
          Alert.alert('Note Not Saved', "Your form note couldn't be saved. Check your connection — it will keep retrying as you type.");
        }
      });
      fireAndForgetSync();
      pendingFormNotesRef.current = null;
      if (onExerciseUpdated) {
        const updatedNotes = { ...loadedNotesRef.current, form_notes: text || null };
        setLoadedNotes(updatedNotes);
        onExerciseUpdated({ ...ex, ...updatedNotes });
      }
    }, 500);
  }, [onExerciseUpdated]);

  const handleMachineNotesChange = useCallback((text: string) => {
    setMachineNotes(text);
    pendingMachineNotesRef.current = text;
    if (machineNotesTimerRef.current) clearTimeout(machineNotesTimerRef.current);
    machineNotesTimerRef.current = setTimeout(() => {
      const ex = exerciseRef.current;
      if (!ex) return;
      updateExerciseMachineNotes(ex.id, text || null).then(() => {
        machineSaveFailedRef.current = false;
      }).catch(e => {
        if (__DEV__) console.error('updateExerciseMachineNotes failed', e);
        Sentry.captureException(e);
        if (!machineSaveFailedRef.current) {
          machineSaveFailedRef.current = true;
          Alert.alert('Note Not Saved', "Your machine note couldn't be saved. Check your connection — it will keep retrying as you type.");
        }
      });
      fireAndForgetSync();
      pendingMachineNotesRef.current = null;
      if (onExerciseUpdated) {
        const updatedNotes = { ...loadedNotesRef.current, machine_notes: text || null };
        setLoadedNotes(updatedNotes);
        onExerciseUpdated({ ...ex, ...updatedNotes });
      }
    }, 500);
  }, [onExerciseUpdated]);

  const handleClose = useCallback(async () => {
    await flushPending();
    onClose();
  }, [onClose]);

  if (!exercise) return null;

  const typeColor = exerciseTypeColor(exercise.type);

  return (
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

          {/* Tab bar */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'details' && styles.tabActive]}
              onPress={() => setActiveTab('details')}
              testID="tab-details"
            >
              <Text style={[styles.tabText, activeTab === 'details' && styles.tabTextActive]}>Details</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'history' && styles.tabActive]}
              onPress={() => setActiveTab('history')}
              testID="tab-history"
            >
              <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>History</Text>
            </TouchableOpacity>
          </View>

          {/* Details tab — always mounted to preserve note editing state */}
          <View style={activeTab !== 'details' ? styles.hiddenTab : styles.visibleTab}>
              <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* Form Notes */}
                {notesLoadError && (
                  <View style={styles.loadErrorBanner}>
                    <Ionicons name="warning-outline" size={14} color={colors.error} />
                    <Text style={styles.loadErrorText}>
                      Couldn't load saved notes. Editing is disabled — close and reopen to retry.
                    </Text>
                  </View>
                )}
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
                    editable={!notesLoadError}
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
                    editable={!notesLoadError}
                    value={machineNotes}
                    onChangeText={handleMachineNotesChange}
                    placeholder="Seat position, attachments, pin settings..."
                    placeholderTextColor={colors.textMuted}
                    testID="machine-notes-input"
                  />
                </View>

                <View style={{ height: spacing.xl }} />
              </ScrollView>
          </View>

          {/* History tab — always mounted to avoid re-fetch on tab switch */}
          <View style={activeTab !== 'history' ? styles.hiddenTab : styles.visibleTab}>
            <Suspense fallback={
              <View style={styles.historyFallback}>
                <ActivityIndicator color={colors.primary} />
              </View>
            }>
              <ExerciseHistoryContent exercise={exercise} />
            </Suspense>
          </View>
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
    height: '85%',
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
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.touchMin,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  tabTextActive: {
    color: colors.primary,
  },
  visibleTab: {
    flex: 1,
  },
  hiddenTab: {
    height: 0,
    overflow: 'hidden',
  },
  body: {
    paddingHorizontal: spacing.md,
  },
  section: {
    marginTop: spacing.lg,
  },
  loadErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.errorBg,
  },
  loadErrorText: {
    flex: 1,
    color: colors.error,
    fontSize: fontSize.xs,
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
  historyFallback: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
});
