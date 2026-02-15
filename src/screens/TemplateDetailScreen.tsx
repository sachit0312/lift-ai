import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Alert, StyleSheet, Platform,
  Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TemplatesStackParamList } from '../navigation/TabNavigator';
import { colors, spacing, fontSize, fontWeight, borderRadius, modalStyles } from '../theme';
import { exerciseTypeColor } from '../utils/exerciseTypeColor';
import {
  getTemplateExercises,
  removeExerciseFromTemplate,
  updateTemplateExerciseDefaults,
  updateTemplate,
} from '../services/database';
import type { TemplateExercise } from '../types/database';

const formatRestTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}:00`;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

type RouteProp = NativeStackScreenProps<TemplatesStackParamList, 'TemplateDetail'>['route'];
type Nav = NativeStackNavigationProp<TemplatesStackParamList, 'TemplateDetail'>;

export default function TemplateDetailScreen() {
  const route = useRoute<RouteProp>();
  const navigation = useNavigation<Nav>();
  const { templateId } = route.params;

  const [exercises, setExercises] = useState<TemplateExercise[]>([]);
  const [templateName, setTemplateName] = useState(route.params.templateName);

  // Modal state for rename
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const loadExercises = useCallback(() => {
    getTemplateExercises(templateId).then(setExercises).catch((e) => console.error('Failed to load exercises', e));
  }, [templateId]);

  useFocusEffect(
    useCallback(() => {
      loadExercises();
    }, [loadExercises]),
  );

  const handleEditName = () => {
    if (Platform.OS === 'ios') {
      Alert.prompt('Rename Template', 'Enter new name', (name) => {
        if (name && name.trim()) {
          updateTemplate(templateId, name.trim()).then(() => {
            setTemplateName(name.trim());
            navigation.setOptions({ title: name.trim() });
          }).catch((e) => {
            console.error('Failed to rename template', e);
            Alert.alert('Error', 'Failed to rename template. Please try again.');
          });
        }
      }, 'plain-text', templateName);
    } else {
      setRenameValue(templateName);
      setShowRenameModal(true);
    }
  };

  const handleRenameConfirm = () => {
    const name = renameValue.trim();
    if (name) {
      setShowRenameModal(false);
      updateTemplate(templateId, name).then(() => {
        setTemplateName(name);
        navigation.setOptions({ title: name });
      }).catch((e) => {
        console.error('Failed to rename template', e);
        Alert.alert('Error', 'Failed to rename template. Please try again.');
      });
    }
  };

  const handleIncreaseSets = useCallback((item: TemplateExercise) => {
    const newSets = item.default_sets + 1;
    updateTemplateExerciseDefaults(item.id, { sets: newSets })
      .then(loadExercises)
      .catch((e) => console.error('Failed to update sets', e));
  }, [loadExercises]);

  const handleDecreaseSets = useCallback((item: TemplateExercise) => {
    const newSets = Math.max(1, item.default_sets - 1);
    if (newSets !== item.default_sets) {
      updateTemplateExerciseDefaults(item.id, { sets: newSets })
        .then(loadExercises)
        .catch((e) => console.error('Failed to update sets', e));
    }
  }, [loadExercises]);

  const handleIncreaseRest = useCallback((item: TemplateExercise) => {
    const newRest = item.rest_seconds + 15;
    updateTemplateExerciseDefaults(item.id, { rest_seconds: newRest })
      .then(loadExercises)
      .catch((e) => console.error('Failed to update rest', e));
  }, [loadExercises]);

  const handleDecreaseRest = useCallback((item: TemplateExercise) => {
    const newRest = Math.max(15, item.rest_seconds - 15);
    if (newRest !== item.rest_seconds) {
      updateTemplateExerciseDefaults(item.id, { rest_seconds: newRest })
        .then(loadExercises)
        .catch((e) => console.error('Failed to update rest', e));
    }
  }, [loadExercises]);

  const handleIncreaseRpe = useCallback((item: TemplateExercise) => {
    const current = item.target_rpe;
    const newRpe = current == null ? 6 : Math.min(10, current + 1);
    updateTemplateExerciseDefaults(item.id, { target_rpe: newRpe })
      .then(loadExercises)
      .catch((e) => console.error('Failed to update RPE', e));
  }, [loadExercises]);

  const handleDecreaseRpe = useCallback((item: TemplateExercise) => {
    const current = item.target_rpe;
    if (current == null) return;
    const newRpe = current <= 1 ? null : current - 1;
    updateTemplateExerciseDefaults(item.id, { target_rpe: newRpe })
      .then(loadExercises)
      .catch((e) => console.error('Failed to update RPE', e));
  }, [loadExercises]);

  const handleRemove = useCallback((item: TemplateExercise) => {
    Alert.alert('Remove Exercise', `Remove "${item.exercise?.name}" from template?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeExerciseFromTemplate(item.id).then(loadExercises).catch((e) => {
          console.error('Failed to remove exercise', e);
          Alert.alert('Error', 'Failed to remove exercise. Please try again.');
        }),
      },
    ]);
  }, [loadExercises]);

  const renderItem = useCallback(({ item, index }: { item: TemplateExercise; index: number }) => (
    <View style={styles.card}>
      <View style={[styles.cardAccent, { backgroundColor: exerciseTypeColor(item.exercise?.type) }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.exerciseName}>{item.exercise?.name ?? 'Unknown'}</Text>
            {item.exercise?.muscle_groups && item.exercise.muscle_groups.length > 0 && (
              <Text style={styles.muscles}>{item.exercise.muscle_groups.join(', ')}</Text>
            )}
          </View>
          <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemove(item)}>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </TouchableOpacity>
        </View>
        <View style={styles.steppersRow}>
          {/* Sets stepper */}
          <View style={styles.stepperGroup}>
            <Ionicons name="barbell-outline" size={14} color={colors.textSecondary} style={styles.stepperIcon} />
            <TouchableOpacity
              testID={`sets-decrease-${index}`}
              style={styles.stepperBtn}
              onPress={() => handleDecreaseSets(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="remove" size={14} color={colors.text} />
            </TouchableOpacity>
            <Text testID={`sets-value-${index}`} style={styles.stepperValue}>{item.default_sets}</Text>
            <TouchableOpacity
              testID={`sets-increase-${index}`}
              style={styles.stepperBtn}
              onPress={() => handleIncreaseSets(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={14} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Rest stepper */}
          <View style={styles.stepperGroup}>
            <Ionicons name="timer-outline" size={14} color={colors.textSecondary} style={styles.stepperIcon} />
            <TouchableOpacity
              testID={`rest-decrease-${index}`}
              style={styles.stepperBtn}
              onPress={() => handleDecreaseRest(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="remove" size={14} color={colors.text} />
            </TouchableOpacity>
            <Text testID={`rest-value-${index}`} style={styles.stepperValue}>{formatRestTime(item.rest_seconds)}</Text>
            <TouchableOpacity
              testID={`rest-increase-${index}`}
              style={styles.stepperBtn}
              onPress={() => handleIncreaseRest(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={14} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* RPE stepper */}
          <View style={styles.stepperGroup}>
            <Ionicons name="flame-outline" size={14} color={colors.textSecondary} style={styles.stepperIcon} />
            <TouchableOpacity
              testID={`rpe-decrease-${index}`}
              style={styles.stepperBtn}
              onPress={() => handleDecreaseRpe(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="remove" size={14} color={colors.text} />
            </TouchableOpacity>
            <Text testID={`rpe-value-${index}`} style={styles.stepperValue}>
              {item.target_rpe != null ? String(item.target_rpe) : 'Off'}
            </Text>
            <TouchableOpacity
              testID={`rpe-increase-${index}`}
              style={styles.stepperBtn}
              onPress={() => handleIncreaseRpe(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={14} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  ), [handleDecreaseSets, handleIncreaseSets, handleDecreaseRest, handleIncreaseRest, handleDecreaseRpe, handleIncreaseRpe, handleRemove]);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.nameRow} onPress={handleEditName} activeOpacity={0.7}>
        <View style={styles.nameRowInner}>
          <Text style={styles.nameValue}>{templateName}</Text>
          <Ionicons name="pencil-outline" size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>

      <FlatList
        data={exercises}
        keyExtractor={(e) => e.id}
        renderItem={renderItem}
        contentContainerStyle={exercises.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="barbell-outline" size={48} color={colors.textMuted} />
            <Text style={styles.empty}>No exercises yet</Text>
            <Text style={styles.emptySub}>Add exercises to build your template.</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => navigation.navigate('ExercisePicker', { templateId })}
        activeOpacity={0.8}
        testID="template-add-exercise-btn"
      >
        <Ionicons name="add-circle-outline" size={20} color={colors.primary} style={{ marginRight: spacing.sm }} />
        <Text style={styles.addBtnText}>Add Exercise</Text>
      </TouchableOpacity>

      {/* Rename Modal */}
      <Modal visible={showRenameModal} transparent animationType="fade" onRequestClose={() => setShowRenameModal(false)}>
        <KeyboardAvoidingView behavior="padding" style={modalStyles.overlay}>
          <TouchableOpacity style={modalStyles.overlay} activeOpacity={1} onPress={() => setShowRenameModal(false)}>
            <TouchableOpacity activeOpacity={1} style={modalStyles.card}>
              <Text style={modalStyles.title}>Rename Template</Text>
              <TextInput
                style={modalStyles.input}
                value={renameValue}
                onChangeText={setRenameValue}
                placeholder="Template name"
                placeholderTextColor={colors.textMuted}
                autoFocus
                onSubmitEditing={handleRenameConfirm}
              />
              <View style={modalStyles.actions}>
                <TouchableOpacity onPress={() => setShowRenameModal(false)} style={modalStyles.cancelBtn}>
                  <Text style={modalStyles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleRenameConfirm} style={[modalStyles.confirmBtn, { backgroundColor: colors.primary }]}>
                  <Text style={modalStyles.confirmText}>Save</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  nameRow: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    padding: spacing.md,
    paddingVertical: spacing.lg,
  },
  nameRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nameValue: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    flex: 1,
  },
  list: {
    padding: spacing.md,
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
  empty: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.md,
  },
  emptySub: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  cardAccent: {
    width: 3,
    alignSelf: 'stretch',
  },
  cardBody: {
    flex: 1,
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  exerciseName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  muscles: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  steppersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    gap: spacing.sm,
    rowGap: spacing.xs,
  },
  stepperGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperIcon: {
    marginRight: 2,
  },
  stepperBtn: {
    width: 26,
    height: 26,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    minWidth: 32,
    textAlign: 'center',
  },
  removeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    marginBottom: spacing.lg,
  },
  addBtnText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
