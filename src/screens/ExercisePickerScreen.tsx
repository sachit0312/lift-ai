import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ScrollView,
  Keyboard, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TemplatesStackParamList } from '../navigation/TabNavigator';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { exerciseTypeColor } from '../utils/exerciseTypeColor';
import { filterExercises } from '../utils/exerciseSearch';
import { MUSCLE_GROUPS, EXERCISE_TYPE_OPTIONS_WITH_ICONS } from '../constants/exercise';
import { getAllExercises, createExercise, addExerciseToTemplate } from '../services/database';
import type { Exercise, ExerciseType } from '../types/database';

type RouteProp = NativeStackScreenProps<TemplatesStackParamList, 'ExercisePicker'>['route'];
type Nav = NativeStackNavigationProp<TemplatesStackParamList, 'ExercisePicker'>;

const typeBadgeColor = exerciseTypeColor;

export default function ExercisePickerScreen() {
  const route = useRoute<RouteProp>();
  const navigation = useNavigation<Nav>();
  const { templateId } = route.params;

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New exercise form state
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ExerciseType>('weighted');
  const [newMuscles, setNewMuscles] = useState<string[]>([]);
  const [newExNotes, setNewExNotes] = useState('');
  const [validationError, setValidationError] = useState('');

  const loadExercises = useCallback(() => {
    getAllExercises().then(setExercises).catch((e) => console.error('Failed to load exercises', e));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadExercises();
    }, [loadExercises]),
  );

  const filtered = useMemo(() => filterExercises(exercises, search), [exercises, search]);

  const handlePick = useCallback(async (exercise: Exercise) => {
    try {
      await addExerciseToTemplate(templateId, exercise.id);
      navigation.goBack();
    } catch (e) {
      console.error('Failed to add exercise to template', e);
      Alert.alert('Error', 'Failed to add exercise. Please try again.');
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
    try {
      const exercise = await createExercise({
        name: newName.trim(),
        type: newType,
        muscle_groups: newMuscles,
        training_goal: 'hypertrophy',
        description: '',
        notes: newExNotes.trim() || null,
      });
      await addExerciseToTemplate(templateId, exercise.id);
      setShowCreateModal(false);
      navigation.goBack();
    } catch (e) {
      console.error('Failed to create exercise', e);
      Alert.alert('Error', 'Failed to create exercise. Please try again.');
    }
  };

  const renderItem = useCallback(({ item }: { item: Exercise }) => (
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
      </View>
    </TouchableOpacity>
  ), [handlePick]);

  const renderCreateModal = () => (
    <Modal
      visible={showCreateModal}
      animationType="slide"
      testID="create-exercise-modal"
      onRequestClose={() => setShowCreateModal(false)}
    >
      <SafeAreaView style={styles.createModalContainer}>
        <View style={styles.createModalHeader}>
          <TouchableOpacity onPress={() => { resetForm(); setShowCreateModal(false); }}>
            <Ionicons name="close" size={24} color={colors.text} />
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
          <View style={styles.typeGrid}>
            {EXERCISE_TYPE_OPTIONS_WITH_ICONS.map((t) => (
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
          <View style={styles.muscleGrid}>
            {MUSCLE_GROUPS.map((mg) => {
              const selected = newMuscles.includes(mg);
              return (
                <TouchableOpacity
                  key={mg}
                  testID={`muscle-${mg}`}
                  style={[
                    styles.muscleChip,
                    selected && styles.muscleChipSelected,
                  ]}
                  onPress={() =>
                    setNewMuscles((prev) =>
                      selected ? prev.filter((m) => m !== mg) : [...prev, mg],
                    )
                  }
                >
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                    {mg}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Notes (optional)</Text>
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

          <TouchableOpacity style={styles.saveBtn} onPress={handleCreate} activeOpacity={0.8} testID="save-exercise-btn">
            <Ionicons name="checkmark-circle" size={18} color={colors.white} style={{ marginRight: spacing.sm }} />
            <Text style={styles.saveBtnText}>Save & Add to Template</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={() => { resetForm(); setShowCreateModal(false); }} activeOpacity={0.8}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
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
            <Ionicons name="search" size={40} color={colors.textMuted} />
            <Text style={styles.empty}>
              {search ? 'No exercises match your search.' : 'No exercises yet. Create one above.'}
            </Text>
          </View>
        }
      />

      {renderCreateModal()}
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
  muscleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  muscleChip: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  muscleChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
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
