import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ScrollView,
  Keyboard, Modal, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TemplatesStackParamList } from '../navigation/TabNavigator';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout, chipStyles } from '../theme';
import { exerciseTypeColor } from '../utils/exerciseTypeColor';
import { filterExercises } from '../utils/exerciseSearch';
import { MUSCLE_GROUPS, EXERCISE_TYPE_OPTIONS_WITH_ICONS } from '../constants/exercise';
import { getAllExercises, createExercise, addExerciseToTemplate, upsertExerciseNote } from '../services/database';
import { pushTemplateExercise } from '../services/sync';

/** Upper bound on the pre-navigation push, so a dead connection can't hang the screen. */
const PUSH_TIMEOUT_MS = 8000;

/** Resolves with the promise's value, or undefined if it outruns `ms`. Never rejects on
 *  timeout — the local write already succeeded, and a later full sync will catch up. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms)),
  ]);
}

/**
 * Tell the user when the row is saved locally but has NOT reached Supabase.
 *
 * This matters more than a normal sync hiccup: pullTemplates deletes any local
 * template_exercise that Supabase doesn't know about, so an un-pushed row will be removed
 * on the next WorkoutScreen focus. Swallowing the failed/timed-out result here would have
 * silently recreated the exact data-loss bug the targeted push exists to prevent.
 */
function warnIfUnpushed(pushed: boolean | undefined) {
  if (pushed) return;
  Alert.alert(
    'Saved locally',
    "This exercise couldn't sync to the cloud yet. Reopen the template once you're back online to make sure it sticks.",
  );
}
import type { Exercise, ExerciseType } from '../types/database';
import * as Sentry from '@sentry/react-native';

type RouteProp = NativeStackScreenProps<TemplatesStackParamList, 'ExercisePicker'>['route'];
type Nav = NativeStackNavigationProp<TemplatesStackParamList, 'ExercisePicker'>;

export default function ExercisePickerScreen() {
  const route = useRoute<RouteProp>();
  const navigation = useNavigation<Nav>();
  const { templateId } = route.params;

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnce = useRef(false);

  // New exercise form state
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ExerciseType>('weighted');
  const [newMuscles, setNewMuscles] = useState<string[]>([]);
  const [newExNotes, setNewExNotes] = useState('');
  const [validationError, setValidationError] = useState('');
  /** True while a pick/create is writing + pushing, so the screen shows progress rather
   *  than appearing frozen. The ref is the actual re-entrancy guard — state updates are
   *  async, so a second tap can land before `saving` has re-rendered. */
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  /** goBack() now runs after an awaited network call, so the screen may already be gone —
   *  popping then would pop whatever is on top of the stack instead of this screen. */
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  const loadExercises = useCallback(() => {
    if (!hasLoadedOnce.current) setLoading(true);
    getAllExercises().then(setExercises)
      .catch((e: unknown) => { if (__DEV__) console.error('Failed to load exercises', e); Sentry.captureException(e); })
      .finally(() => { setLoading(false); hasLoadedOnce.current = true; });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadExercises();
    }, [loadExercises]),
  );

  const filtered = useMemo(() => filterExercises(exercises, search), [exercises, search]);

  const handlePick = useCallback(async (exercise: Exercise) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      setSaving(true);
      const added = await addExerciseToTemplate(templateId, exercise.id);
      // Push BEFORE returning, not fire-and-forget. pullTemplates deletes any local
      // template_exercise whose id isn't in Supabase, and the very next WorkoutScreen
      // focus triggers that pull — so a row that hasn't been pushed yet gets silently
      // deleted and the exercise vanishes from the template.
      //
      // Targeted push (3 rows) rather than syncToSupabase(), which would re-upload the
      // entire finished-workout corpus just to persist this one row. Bounded so a dead
      // connection can't leave the screen looking frozen.
      const pushed = await withTimeout(pushTemplateExercise(added.id), PUSH_TIMEOUT_MS);
      warnIfUnpushed(pushed);
      if (isMountedRef.current) navigation.goBack();
    } catch (e: unknown) {
      if (__DEV__) console.error('Failed to add exercise to template', e);
      Sentry.captureException(e);
      Alert.alert('Error', 'Failed to add exercise. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [templateId, navigation]);

  const resetForm = () => {
    setNewName('');
    setNewType('weighted');
    setNewMuscles([]);
    setNewExNotes('');
    setValidationError('');
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      setValidationError('Exercise name is required');
      return;
    }
    setValidationError('');
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const exercise = await createExercise({
        name: newName.trim(),
        type: newType,
        muscle_groups: newMuscles,
        training_goal: 'hypertrophy',
        description: '',
      });
      if (newExNotes.trim()) {
        await upsertExerciseNote(exercise.id, 'form_notes', newExNotes.trim());
      }
      const added = await addExerciseToTemplate(templateId, exercise.id);
      // Await the push for the same reason as handlePick. pushTemplateExercise handles the
      // FK ordering here — the newly created custom exercise (and its form notes) go up
      // before the template_exercise row that references it.
      const pushed = await withTimeout(pushTemplateExercise(added.id), PUSH_TIMEOUT_MS);
      warnIfUnpushed(pushed);
      setShowCreateModal(false);
      if (isMountedRef.current) navigation.goBack();
    } catch (e: unknown) {
      if (__DEV__) console.error('Failed to create exercise', e);
      Sentry.captureException(e);
      Alert.alert('Error', 'Failed to create exercise. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const renderItem = useCallback(({ item }: { item: Exercise }) => (
    <TouchableOpacity style={styles.card} onPress={() => handlePick(item)} activeOpacity={0.7}>
      <View style={styles.cardContent}>
        <View style={styles.cardTop}>
          <Text style={styles.exerciseName}>{item.name}</Text>
          <View style={[styles.badge, { backgroundColor: exerciseTypeColor(item.type) + '20' }]}>
            <Text style={[styles.badgeText, { color: exerciseTypeColor(item.type) }]}>{item.type}</Text>
          </View>
        </View>
        {item.muscle_groups.length > 0 && (
          <Text style={styles.muscles}>{item.muscle_groups.join(', ')}</Text>
        )}
      </View>
    </TouchableOpacity>
  ), [handlePick]);

  const renderCreateModal = () => (
    <Modal
      visible={showCreateModal}
      animationType="slide"
      testID="create-exercise-modal"
      // Ignore hardware/back dismissal mid-save for the same reason the buttons are disabled.
      onRequestClose={() => { if (!saving) setShowCreateModal(false); }}
    >
      <SafeAreaView style={styles.createModalContainer}>
        <View style={styles.createModalHeader}>
          <TouchableOpacity
            onPress={() => { resetForm(); setShowCreateModal(false); }}
            disabled={saving}
          >
            <Ionicons name="close" size={24} color={saving ? colors.textMuted : colors.text} />
          </TouchableOpacity>
          <Text style={styles.createModalTitle}>Create Exercise</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView style={styles.createModalBody} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={[styles.input, validationError ? styles.inputError : null]}
            value={newName}
            onChangeText={(v) => { setNewName(v); setValidationError(''); }}
            placeholder='e.g. "Incline Dumbbell Press"'
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            testID="exercise-name-input"
          />
          {validationError ? <Text style={styles.errorText}>{validationError}</Text> : null}

          <Text style={styles.label}>Type</Text>
          <View style={[chipStyles.typeGrid, { marginTop: spacing.xs }]}>
            {EXERCISE_TYPE_OPTIONS_WITH_ICONS.map((t) => (
              <TouchableOpacity
                key={t.value}
                style={[
                  chipStyles.typeChip,
                  newType === t.value && { backgroundColor: exerciseTypeColor(t.value), borderColor: exerciseTypeColor(t.value) },
                ]}
                onPress={() => setNewType(t.value)}
              >
                <Ionicons
                  name={t.icon}
                  size={14}
                  color={newType === t.value ? colors.white : colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={[chipStyles.chipText, newType === t.value && chipStyles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Muscle Groups</Text>
          <View style={[chipStyles.muscleGrid, { marginTop: spacing.xs }]}>
            {MUSCLE_GROUPS.map((mg) => {
              const selected = newMuscles.includes(mg);
              return (
                <TouchableOpacity
                  key={mg}
                  testID={`muscle-${mg}`}
                  style={[
                    chipStyles.muscleChip,
                    selected && chipStyles.muscleChipSelected,
                  ]}
                  onPress={() =>
                    setNewMuscles((prev) =>
                      selected ? prev.filter((m) => m !== mg) : [...prev, mg],
                    )
                  }
                >
                  <Text style={[chipStyles.chipText, selected && chipStyles.chipTextActive]}>
                    {mg}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Form Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={newExNotes}
            onChangeText={setNewExNotes}
            placeholder="Form cues, setup notes..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={2}
            testID="exercise-notes-input"
          />

          {/* Disabled while saving. React Native presents Modal in its own native layer, so
              the screen-level saving overlay renders BEHIND this modal and cannot block it —
              without these guards the user could tap Cancel mid-push, believe they had
              backed out, and still end up with the exercise added and the screen popped. */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.btnDisabled]}
            onPress={handleCreate}
            activeOpacity={0.8}
            disabled={saving}
            testID="save-exercise-btn"
          >
            {saving ? (
              <ActivityIndicator color={colors.white} style={{ marginRight: spacing.sm }} />
            ) : (
              <Ionicons name="checkmark-circle" size={18} color={colors.white} style={{ marginRight: spacing.sm }} />
            )}
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save & Add to Template'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.cancelBtn, saving && styles.btnDisabled]}
            onPress={() => { resetForm(); setShowCreateModal(false); }}
            activeOpacity={0.8}
            disabled={saving}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchBar}
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or muscle group..."
          placeholderTextColor={colors.textMuted}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={styles.createToggle}
        onPress={() => setShowCreateModal(true)}
        activeOpacity={0.7}
        testID="create-exercise-toggle"
      >
        <Ionicons name="add-circle-outline" size={18} color={colors.primary} style={{ marginRight: spacing.sm }} />
        <Text style={styles.createToggleText}>Create New Exercise</Text>
      </TouchableOpacity>

      <FlatList
        data={filtered}
        keyExtractor={(e) => e.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="search" size={48} color={colors.textMuted} />
            <Text style={styles.empty}>
              {search ? 'No exercises match your search.' : 'No exercises yet. Create one above.'}
            </Text>
          </View>
        }
      />

      {renderCreateModal()}

      {/* Blocks input and shows progress while the row is written and pushed. Without this
          the screen looked frozen for the duration of the network round trip. */}
      {saving && (
        <View style={styles.savingOverlay} pointerEvents="auto" testID="picker-saving-overlay">
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.savingText}>Adding exercise…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  savingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.overlay,
  },
  savingText: {
    marginTop: spacing.md,
    color: colors.text,
    fontSize: fontSize.md,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    margin: spacing.md,
    marginBottom: 0,
    paddingHorizontal: spacing.md,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchBar: {
    flex: 1,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: fontSize.md,
  },
  createToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  createToggleText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  createModalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  createModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  createModalTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  createModalBody: {
    flex: 1,
    padding: spacing.md,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: fontSize.md,
  },
  inputError: {
    borderColor: colors.error,
  },
  textArea: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    minHeight: layout.buttonHeight,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  saveBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  cancelBtn: {
    padding: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  cancelBtnText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  list: {
    padding: spacing.md,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: layout.cardGap,
    overflow: 'hidden',
  },
  cardContent: {
    flex: 1,
    padding: spacing.md,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  exerciseName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    flex: 1,
  },
  badge: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginLeft: spacing.sm,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  muscles: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  empty: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
