import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout } from '../theme';
import { modalStyles } from '../theme/sharedStyles';
import { getAllExercises, updateExercise } from '../services/database';
import { syncToSupabase } from '../services/sync';
import { filterExercises } from '../utils/exerciseSearch';
import { exerciseTypeColor } from '../utils/exerciseTypeColor';
import { MUSCLE_GROUPS, EXERCISE_TYPE_OPTIONS_WITH_ICONS } from '../constants/exercise';
import ExerciseHistoryModal from '../components/ExerciseHistoryModal';
import type { Exercise, ExerciseType } from '../types/database';

export default function ExercisesScreen() {
  const [loading, setLoading] = useState(true);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState('');
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedOnce = useRef(false);

  // Edit modal state
  const [editExercise, setEditExercise] = useState<Exercise | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<ExerciseType>('weighted');
  const [editMuscles, setEditMuscles] = useState<string[]>([]);
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadExercises();
    }, [])
  );

  async function loadExercises() {
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const all = await getAllExercises();
      setExercises(all);
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const all = await getAllExercises();
      setExercises(all);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const openEditModal = useCallback((exercise: Exercise) => {
    setEditExercise(exercise);
    setEditName(exercise.name);
    setEditType(exercise.type);
    setEditMuscles([...exercise.muscle_groups]);
    setEditNotes(exercise.notes ?? '');
  }, []);

  const closeEditModal = useCallback(() => {
    setEditExercise(null);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editExercise || !editName.trim() || editMuscles.length === 0) return;
    setSaving(true);
    try {
      await updateExercise(editExercise.id, {
        name: editName.trim(),
        type: editType,
        muscle_groups: editMuscles,
        notes: editNotes.trim() || null,
      });
      syncToSupabase().catch(() => {});
      await loadExercises();
      closeEditModal();
    } catch {
      Alert.alert('Error', 'Failed to save exercise. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [editExercise, editName, editType, editMuscles, editNotes, closeEditModal]);

  const filtered = useMemo(() => filterExercises(exercises, search), [exercises, search]);

  const renderExercise = useCallback(({ item }: { item: Exercise }) => (
    <TouchableOpacity
      style={styles.exerciseCard}
      onPress={() => setSelectedExercise(item)}
      onLongPress={() => openEditModal(item)}
      activeOpacity={0.7}
    >
      <View style={styles.exerciseInfo}>
        <Text style={styles.exerciseName}>{item.name}</Text>
        <Text style={styles.exerciseMeta}>
          {item.type} · {item.muscle_groups.join(', ') || 'No muscles'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  ), [openEditModal]);

  if (loading) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Exercises</Text>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search exercises..."
          placeholderTextColor={colors.textMuted}
          testID="exercise-search"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderExercise}
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="barbell-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No Exercises Yet</Text>
            <Text style={styles.emptySubtext}>
              Exercises will appear here once you sync or create them from a template.
            </Text>
          </View>
        }
      />

      <ExerciseHistoryModal
        visible={!!selectedExercise}
        exercise={selectedExercise}
        onClose={() => setSelectedExercise(null)}
      />

      {/* Edit Exercise Modal */}
      <Modal visible={!!editExercise} transparent animationType="fade" onRequestClose={closeEditModal}>
        <KeyboardAvoidingView style={modalStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[modalStyles.card, { width: '90%', maxWidth: 400 }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={modalStyles.title}>Edit Exercise</Text>

              <Text style={styles.editLabel}>Name</Text>
              <TextInput
                style={modalStyles.input}
                value={editName}
                onChangeText={setEditName}
                placeholder="Exercise name"
                placeholderTextColor={colors.textMuted}
                testID="edit-exercise-name"
              />

              <Text style={styles.editLabel}>Type</Text>
              <View style={styles.typeGrid}>
                {EXERCISE_TYPE_OPTIONS_WITH_ICONS.map((t) => (
                  <TouchableOpacity
                    key={t.value}
                    style={[
                      styles.typeChip,
                      editType === t.value && { backgroundColor: exerciseTypeColor(t.value), borderColor: exerciseTypeColor(t.value) },
                    ]}
                    onPress={() => setEditType(t.value)}
                  >
                    <Ionicons
                      name={t.icon}
                      size={14}
                      color={editType === t.value ? colors.white : colors.textSecondary}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={[styles.chipText, editType === t.value && styles.chipTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.editLabel}>Muscle Groups</Text>
              <View style={styles.muscleGrid}>
                {MUSCLE_GROUPS.map((mg) => {
                  const selected = editMuscles.includes(mg);
                  return (
                    <TouchableOpacity
                      key={mg}
                      style={[styles.muscleChip, selected && styles.muscleChipSelected]}
                      onPress={() =>
                        setEditMuscles((prev) =>
                          selected ? prev.filter((m) => m !== mg) : [...prev, mg],
                        )
                      }
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{mg}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.editLabel}>Notes</Text>
              <TextInput
                style={[modalStyles.input, styles.notesInput]}
                value={editNotes}
                onChangeText={setEditNotes}
                placeholder="Machine settings, form cues, goals..."
                placeholderTextColor={colors.textMuted}
                multiline
                testID="edit-exercise-notes"
              />
            </ScrollView>

            <View style={modalStyles.actions}>
              <TouchableOpacity style={modalStyles.cancelBtn} onPress={closeEditModal}>
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[modalStyles.confirmBtn, { backgroundColor: colors.primary, opacity: (!editName.trim() || editMuscles.length === 0 || saving) ? 0.5 : 1 }]}
                onPress={handleSaveEdit}
                disabled={!editName.trim() || editMuscles.length === 0 || saving}
              >
                <Text style={modalStyles.confirmText}>{saving ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
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
  header: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginHorizontal: layout.screenPaddingH,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    minHeight: layout.inputHeight,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    marginLeft: spacing.sm,
  },
  listContent: {
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: 100,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginTop: spacing.lg,
  },
  emptySubtext: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: spacing.sm,
    textAlign: 'center' as const,
  },
  exerciseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: layout.cardGap,
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  exerciseMeta: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xxs,
  },
  editLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
  },
  muscleChip: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 36,
  },
  muscleChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
