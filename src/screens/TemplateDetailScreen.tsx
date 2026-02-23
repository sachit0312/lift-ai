import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Alert, StyleSheet, Platform,
  Modal, TextInput, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TemplatesStackParamList } from '../navigation/TabNavigator';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout, modalStyles } from '../theme';
import {
  getTemplateExercises,
  removeExerciseFromTemplate,
  updateTemplateExerciseDefaults,
  updateTemplate,
} from '../services/database';
import { deleteTemplateExerciseFromSupabase } from '../services/sync';
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
  const [loading, setLoading] = useState(true);
  const hasLoadedOnce = useRef(false);

  // Modal state for rename
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const loadExercises = useCallback(() => {
    if (!hasLoadedOnce.current) setLoading(true);
    getTemplateExercises(templateId).then(setExercises)
      .catch((e: unknown) => console.error('Failed to load exercises', e))
      .finally(() => { setLoading(false); hasLoadedOnce.current = true; });
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

  const handleIncreaseWarmupSets = useCallback((item: TemplateExercise) => {
    const newWarmup = item.warmup_sets + 1;
    updateTemplateExerciseDefaults(item.id, { warmup_sets: newWarmup })
      .then(loadExercises)
      .catch((e) => console.error('Failed to update warmup sets', e));
  }, [loadExercises]);

  const handleDecreaseWarmupSets = useCallback((item: TemplateExercise) => {
    const newWarmup = Math.max(0, item.warmup_sets - 1);
    if (newWarmup !== item.warmup_sets) {
      updateTemplateExerciseDefaults(item.id, { warmup_sets: newWarmup })
        .then(loadExercises)
        .catch((e) => console.error('Failed to update warmup sets', e));
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

  const handleRemove = useCallback((item: TemplateExercise) => {
    Alert.alert('Remove Exercise', `Remove "${item.exercise?.name}" from template?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeExerciseFromTemplate(item.id)
            .then(() => {
              deleteTemplateExerciseFromSupabase(item.id); // fire-and-forget
              return loadExercises();
            })
            .catch((e) => {
              console.error('Failed to remove exercise', e);
              Alert.alert('Error', 'Failed to remove exercise. Please try again.');
            });
        },
      },
    ]);
  }, [loadExercises]);

  const renderItem = useCallback(({ item, index }: { item: TemplateExercise; index: number }) => (
    <View style={styles.card}>
      {/* Top row: name + delete */}
      <View style={styles.cardTopRow}>
        <Text style={styles.exerciseName}>{item.exercise?.name ?? 'Unknown'}</Text>
        <TouchableOpacity testID={`remove-btn-${index}`} style={styles.removeBtn} onPress={() => handleRemove(item)}>
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Muscle groups */}
      {item.exercise?.muscle_groups && item.exercise.muscle_groups.length > 0 && (
        <Text style={styles.muscles}>{item.exercise.muscle_groups.join(', ')}</Text>
      )}

      {/* Controls row */}
      <View style={styles.controlsRow}>
        {/* Warmup stepper */}
        <View style={styles.stepperGroup}>
          <Text testID={`warmup-value-${index}`} style={styles.stepperLabel}>{item.warmup_sets} warmup</Text>
          <View style={styles.stepperBtnRow}>
            <TouchableOpacity
              testID={`warmup-decrease-${index}`}
              style={styles.stepperBtn}
              onPress={() => handleDecreaseWarmupSets(item)}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Ionicons name="remove" size={22} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              testID={`warmup-increase-${index}`}
              style={styles.stepperBtn}
              onPress={() => handleIncreaseWarmupSets(item)}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Ionicons name="add" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Working sets stepper */}
        <View style={styles.stepperGroup}>
          <Text testID={`sets-value-${index}`} style={styles.stepperLabel}>{item.default_sets} working</Text>
          <View style={styles.stepperBtnRow}>
            <TouchableOpacity
              testID={`sets-decrease-${index}`}
              style={styles.stepperBtn}
              onPress={() => handleDecreaseSets(item)}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Ionicons name="remove" size={22} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              testID={`sets-increase-${index}`}
              style={styles.stepperBtn}
              onPress={() => handleIncreaseSets(item)}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Ionicons name="add" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Rest stepper */}
        <View style={styles.stepperGroup}>
          <Text testID={`rest-value-${index}`} style={styles.stepperLabel}>{formatRestTime(item.rest_seconds)} rest</Text>
          <View style={styles.stepperBtnRow}>
            <TouchableOpacity
              testID={`rest-decrease-${index}`}
              style={styles.stepperBtn}
              onPress={() => handleDecreaseRest(item)}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Ionicons name="remove" size={22} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              testID={`rest-increase-${index}`}
              style={styles.stepperBtn}
              onPress={() => handleIncreaseRest(item)}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Ionicons name="add" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  ), [handleDecreaseWarmupSets, handleIncreaseWarmupSets, handleDecreaseSets, handleIncreaseSets, handleDecreaseRest, handleIncreaseRest, handleRemove]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

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
    paddingHorizontal: layout.screenPaddingH,
    paddingVertical: spacing.md,
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
    marginBottom: layout.cardGap,
    padding: spacing.lg,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  exerciseName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    flex: 1,
  },
  muscles: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  controlsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  stepperGroup: {
    alignItems: 'flex-start' as const,
  },
  stepperLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.sm,
  },
  stepperBtnRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stepperBtn: {
    width: layout.touchMin,
    height: layout.touchMin,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  removeBtn: {
    minWidth: layout.touchMin,
    minHeight: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: spacing.md,
    padding: spacing.md,
    minHeight: layout.buttonHeightSm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.primaryBorderSubtle,
    backgroundColor: colors.primaryMuted,
    marginBottom: spacing.lg,
  },
  addBtnText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
