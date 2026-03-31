import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Alert, StyleSheet, Platform,
  Modal, TextInput, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TemplatesStackParamList } from '../navigation/TabNavigator';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout, modalStyles } from '../theme';
import {
  getTemplateExercises,
  removeExerciseFromTemplate,
  updateTemplateExerciseDefaults,
  updateTemplateExerciseOrder,
  updateTemplate,
} from '../services/database';
import { deleteTemplateExerciseFromSupabase, fireAndForgetSync, pushTemplateOrderToSupabase } from '../services/sync';
import type { TemplateExercise } from '../types/database';
import * as Sentry from '@sentry/react-native';

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
      .catch((e: unknown) => { if (__DEV__) console.error('Failed to load exercises', e); Sentry.captureException(e); })
      .finally(() => { setLoading(false); hasLoadedOnce.current = true; });
  }, [templateId]);

  useFocusEffect(
    useCallback(() => {
      loadExercises();
    }, [loadExercises]),
  );

  function performRename(name: string) {
    updateTemplate(templateId, name).then(() => {
      setTemplateName(name);
      navigation.setOptions({ title: name });
    }).catch((e) => {
      if (__DEV__) console.error('Failed to rename template', e);
      Sentry.captureException(e);
      Alert.alert('Error', 'Failed to rename template. Please try again.');
    });
  }

  const handleEditName = () => {
    if (Platform.OS === 'ios') {
      Alert.prompt('Rename Template', 'Enter new name', (name) => {
        if (name && name.trim()) performRename(name.trim());
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
      performRename(name);
    }
  };

  const makeStepperHandler = useCallback(
    (field: string, getCurrent: (item: TemplateExercise) => number, computeNew: (current: number) => number) =>
      (item: TemplateExercise) => {
        const current = getCurrent(item);
        const newValue = computeNew(current);
        if (newValue === current) return;
        updateTemplateExerciseDefaults(item.id, { [field]: newValue })
          .then(() => { fireAndForgetSync(); return loadExercises(); })
          .catch((e) => { if (__DEV__) console.error(`Failed to update ${field}`, e); Sentry.captureException(e); });
      },
    [loadExercises],
  );

  const handleIncreaseSets = useMemo(() => makeStepperHandler('sets', i => i.default_sets, v => v + 1), [makeStepperHandler]);
  const handleDecreaseSets = useMemo(() => makeStepperHandler('sets', i => i.default_sets, v => Math.max(1, v - 1)), [makeStepperHandler]);
  const handleIncreaseWarmupSets = useMemo(() => makeStepperHandler('warmup_sets', i => i.warmup_sets, v => v + 1), [makeStepperHandler]);
  const handleDecreaseWarmupSets = useMemo(() => makeStepperHandler('warmup_sets', i => i.warmup_sets, v => Math.max(0, v - 1)), [makeStepperHandler]);
  const handleIncreaseRest = useMemo(() => makeStepperHandler('rest_seconds', i => i.rest_seconds, v => v + 15), [makeStepperHandler]);
  const handleDecreaseRest = useMemo(() => makeStepperHandler('rest_seconds', i => i.rest_seconds, v => Math.max(15, v - 15)), [makeStepperHandler]);

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
              if (__DEV__) console.error('Failed to remove exercise', e);
              Sentry.captureException(e);
              Alert.alert('Error', 'Failed to remove exercise. Please try again.');
            });
        },
      },
    ]);
  }, [loadExercises]);

  const handleDragEnd = useCallback(({ data }: { data: TemplateExercise[] }) => {
    const previous = exercises;
    setExercises(data);
    const orderedIds = data.map((e) => e.id);
    updateTemplateExerciseOrder(templateId, orderedIds)
      .then(() => { fireAndForgetSync(); pushTemplateOrderToSupabase(templateId); })
      .catch((e) => {
        if (__DEV__) console.error('Failed to update exercise order', e);
        Sentry.captureException(e);
        setExercises(previous);
      });
  }, [templateId, exercises]);

  const renderItem = useCallback(({ item, getIndex, drag, isActive }: RenderItemParams<TemplateExercise>) => {
    const index = getIndex() ?? 0;
    return (
      <ScaleDecorator>
        <View style={[styles.card, isActive && styles.cardDragging]}>
          {/* Top row: drag handle + name + delete */}
          <View style={styles.cardTopRow}>
            <TouchableOpacity
              onLongPress={drag}
              delayLongPress={150}
              style={styles.dragHandle}
              testID={`drag-handle-${index}`}
            >
              <Ionicons name="reorder-three" size={22} color={colors.textMuted} />
            </TouchableOpacity>
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
              <Text testID={`warmup-value-${index}`} style={styles.stepperLabel} numberOfLines={1}>{item.warmup_sets} warmup</Text>
              <View style={styles.stepperBtnRow}>
                <TouchableOpacity
                  testID={`warmup-decrease-${index}`}
                  style={styles.stepperBtn}
                  onPress={() => handleDecreaseWarmupSets(item)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="remove" size={22} color={colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`warmup-increase-${index}`}
                  style={styles.stepperBtn}
                  onPress={() => handleIncreaseWarmupSets(item)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="add" size={22} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Working sets stepper */}
            <View style={styles.stepperGroup}>
              <Text testID={`sets-value-${index}`} style={styles.stepperLabel} numberOfLines={1}>{item.default_sets} working</Text>
              <View style={styles.stepperBtnRow}>
                <TouchableOpacity
                  testID={`sets-decrease-${index}`}
                  style={styles.stepperBtn}
                  onPress={() => handleDecreaseSets(item)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="remove" size={22} color={colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`sets-increase-${index}`}
                  style={styles.stepperBtn}
                  onPress={() => handleIncreaseSets(item)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="add" size={22} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Rest stepper */}
            <View style={styles.stepperGroup}>
              <Text testID={`rest-value-${index}`} style={styles.stepperLabel} numberOfLines={1}>{formatRestTime(item.rest_seconds)} rest</Text>
              <View style={styles.stepperBtnRow}>
                <TouchableOpacity
                  testID={`rest-decrease-${index}`}
                  style={styles.stepperBtn}
                  onPress={() => handleDecreaseRest(item)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="remove" size={22} color={colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`rest-increase-${index}`}
                  style={styles.stepperBtn}
                  onPress={() => handleIncreaseRest(item)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="add" size={22} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </ScaleDecorator>
    );
  }, [makeStepperHandler, handleRemove]);

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

      <DraggableFlatList
        data={exercises}
        keyExtractor={(e) => e.id}
        renderItem={renderItem}
        onDragEnd={handleDragEnd}
        containerStyle={{ flex: 1 }}
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
  cardDragging: {
    opacity: 0.9,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dragHandle: {
    minWidth: layout.touchMin,
    minHeight: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.sm,
    marginRight: spacing.xs,
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
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  stepperGroup: {
    flex: 1,
    alignItems: 'flex-start',
  },
  stepperLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.sm,
  },
  stepperBtnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stepperBtn: {
    width: 36,
    height: 36,
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
