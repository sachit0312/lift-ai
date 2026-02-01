import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ScrollView,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TemplatesStackParamList } from '../navigation/TabNavigator';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { getAllExercises, createExercise, addExerciseToTemplate } from '../services/database';
import type { Exercise, ExerciseType, TrainingGoal } from '../types/database';

type RouteProp = NativeStackScreenProps<TemplatesStackParamList, 'ExercisePicker'>['route'];
type Nav = NativeStackNavigationProp<TemplatesStackParamList, 'ExercisePicker'>;

const EXERCISE_TYPES: { value: ExerciseType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'weighted', label: 'Weighted', icon: 'barbell-outline' },
  { value: 'bodyweight', label: 'Bodyweight', icon: 'body-outline' },
  { value: 'machine', label: 'Machine', icon: 'cog-outline' },
  { value: 'cable', label: 'Cable', icon: 'git-pull-request-outline' },
];

const TRAINING_GOALS: { value: TrainingGoal; label: string; description: string }[] = [
  { value: 'strength', label: 'Strength', description: 'Heavy weight, low reps (1-5)' },
  { value: 'hypertrophy', label: 'Hypertrophy', description: 'Moderate weight, 8-12 reps' },
  { value: 'endurance', label: 'Endurance', description: 'Light weight, 15+ reps' },
];

const typeBadgeColor = (type: ExerciseType) => {
  switch (type) {
    case 'weighted': return colors.primary;
    case 'bodyweight': return colors.success;
    case 'machine': return colors.warning;
    case 'cable': return colors.accent;
  }
};

export default function ExercisePickerScreen() {
  const route = useRoute<RouteProp>();
  const navigation = useNavigation<Nav>();
  const { templateId } = route.params;

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  // New exercise form state
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ExerciseType>('weighted');
  const [newMuscles, setNewMuscles] = useState('');
  const [newGoal, setNewGoal] = useState<TrainingGoal>('hypertrophy');
  const [newDescription, setNewDescription] = useState('');
  const [validationError, setValidationError] = useState('');

  const loadExercises = useCallback(() => {
    getAllExercises().then(setExercises);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadExercises();
    }, [loadExercises]),
  );

  const filtered = exercises.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.muscle_groups.some(m => m.toLowerCase().includes(search.toLowerCase())),
  );

  const handlePick = async (exercise: Exercise) => {
    await addExerciseToTemplate(templateId, exercise.id);
    navigation.goBack();
  };

  const resetForm = () => {
    setNewName('');
    setNewType('weighted');
    setNewMuscles('');
    setNewGoal('hypertrophy');
    setNewDescription('');
    setValidationError('');
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      setValidationError('Exercise name is required');
      return;
    }
    setValidationError('');
    const muscleGroups = newMuscles
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const exercise = await createExercise({
      name: newName.trim(),
      type: newType,
      muscle_groups: muscleGroups,
      training_goal: newGoal,
      description: newDescription.trim(),
    });
    await addExerciseToTemplate(templateId, exercise.id);
    navigation.goBack();
  };

  const renderItem = ({ item }: { item: Exercise }) => (
    <TouchableOpacity style={styles.card} onPress={() => handlePick(item)} activeOpacity={0.7}>
      <View style={[styles.typeDot, { backgroundColor: typeBadgeColor(item.type) }]} />
      <View style={styles.cardContent}>
        <View style={styles.cardTop}>
          <Text style={styles.exerciseName}>{item.name}</Text>
          <View style={[styles.badge, { backgroundColor: typeBadgeColor(item.type) + '20', borderColor: typeBadgeColor(item.type) }]}>
            <Text style={[styles.badgeText, { color: typeBadgeColor(item.type) }]}>{item.type}</Text>
          </View>
        </View>
        {item.muscle_groups.length > 0 && (
          <Text style={styles.muscles}>{item.muscle_groups.join(', ')}</Text>
        )}
        {item.training_goal && (
          <Text style={styles.goalHint}>{item.training_goal}</Text>
        )}
      </View>
    </TouchableOpacity>
  );

  const selectedGoalInfo = TRAINING_GOALS.find(g => g.value === newGoal);

  const renderCreateForm = () => (
    <View style={styles.createForm}>
      <View style={styles.createFormHeader}>
        <View style={styles.createFormTitleRow}>
          <Ionicons name="add-circle" size={20} color={colors.primary} />
          <Text style={styles.createTitle}>Create New Exercise</Text>
        </View>
      </View>

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={[styles.input, validationError ? styles.inputError : null]}
        value={newName}
        onChangeText={(v) => { setNewName(v); setValidationError(''); }}
        placeholder='e.g. "Incline Dumbbell Press"'
        placeholderTextColor={colors.textMuted}
        returnKeyType="done"
        onSubmitEditing={() => Keyboard.dismiss()}
      />
      {validationError ? <Text style={styles.errorText}>{validationError}</Text> : null}

      <Text style={styles.label}>Type</Text>
      <View style={styles.typeGrid}>
        {EXERCISE_TYPES.map((t) => (
          <TouchableOpacity
            key={t.value}
            style={[
              styles.typeChip,
              newType === t.value && { backgroundColor: typeBadgeColor(t.value), borderColor: typeBadgeColor(t.value) },
            ]}
            onPress={() => setNewType(t.value)}
          >
            <Ionicons
              name={t.icon}
              size={14}
              color={newType === t.value ? colors.white : colors.textSecondary}
              style={{ marginRight: 4 }}
            />
            <Text style={[styles.chipText, newType === t.value && styles.chipTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Muscle Groups</Text>
      <TextInput
        style={styles.input}
        value={newMuscles}
        onChangeText={setNewMuscles}
        placeholder="e.g. chest, triceps, shoulders"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>Training Goal</Text>
      <View style={styles.goalList}>
        {TRAINING_GOALS.map((g) => (
          <TouchableOpacity
            key={g.value}
            style={[styles.goalOption, newGoal === g.value && styles.goalOptionActive]}
            onPress={() => setNewGoal(g.value)}
          >
            <View style={styles.goalOptionHeader}>
              <View style={[styles.radioOuter, newGoal === g.value && styles.radioOuterActive]}>
                {newGoal === g.value && <View style={styles.radioInner} />}
              </View>
              <Text style={[styles.goalLabel, newGoal === g.value && styles.goalLabelActive]}>{g.label}</Text>
            </View>
            <Text style={styles.goalDesc}>{g.description}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Description (optional)</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={newDescription}
        onChangeText={setNewDescription}
        placeholder="Form cues, setup notes..."
        placeholderTextColor={colors.textMuted}
        multiline
        numberOfLines={2}
      />

      <TouchableOpacity style={styles.saveBtn} onPress={handleCreate} activeOpacity={0.8}>
        <Ionicons name="checkmark-circle" size={18} color={colors.white} style={{ marginRight: spacing.sm }} />
        <Text style={styles.saveBtnText}>Save & Add to Template</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={() => { resetForm(); setShowCreate(false); }} activeOpacity={0.8}>
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

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
        onPress={() => { if (showCreate) resetForm(); setShowCreate(!showCreate); }}
        activeOpacity={0.7}
      >
        <Ionicons name={showCreate ? 'chevron-up' : 'add-circle-outline'} size={18} color={colors.primary} style={{ marginRight: spacing.sm }} />
        <Text style={styles.createToggleText}>
          {showCreate ? 'Hide Form' : 'Create New Exercise'}
        </Text>
      </TouchableOpacity>

      {showCreate && renderCreateForm()}

      <FlatList
        data={filtered}
        keyExtractor={(e) => e.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="search" size={40} color={colors.textMuted} />
            <Text style={styles.empty}>
              {search ? 'No exercises match your search.' : 'No exercises yet. Create one above.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
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
  createForm: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  createFormHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  createFormTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  createTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  aiParsedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryDim + '30',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    gap: 4,
  },
  aiParsedText: {
    color: colors.primaryLight,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
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
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  chipTextActive: {
    color: colors.white,
    fontWeight: fontWeight.semibold,
  },
  goalList: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  goalOption: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  goalOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryDim + '15',
  },
  goalOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  goalLabel: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  goalLabelActive: {
    color: colors.primaryLight,
  },
  goalDesc: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: 2,
    marginLeft: 26,
  },
  aiBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    width: 48,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
  },
  aiBtnDisabled: {
    opacity: 0.5,
  },
  aiHint: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.xxs,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
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
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  typeDot: {
    width: 3,
    alignSelf: 'stretch',
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
    borderWidth: 1,
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
  goalHint: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: 2,
    fontStyle: 'italic',
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
