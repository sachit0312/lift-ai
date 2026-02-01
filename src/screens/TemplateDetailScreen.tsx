import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Alert, StyleSheet, Platform,
  Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TemplatesStackParamList } from '../navigation/TabNavigator';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import {
  getTemplateExercises,
  removeExerciseFromTemplate,
  updateTemplateExerciseDefaults,
  updateTemplate,
} from '../services/database';
import type { TemplateExercise, ExerciseType } from '../types/database';

type RouteProp = NativeStackScreenProps<TemplatesStackParamList, 'TemplateDetail'>['route'];
type Nav = NativeStackNavigationProp<TemplatesStackParamList, 'TemplateDetail'>;

const exerciseTypeColor = (type?: ExerciseType) => {
  switch (type) {
    case 'weighted': return colors.primary;
    case 'bodyweight': return colors.success;
    case 'machine': return colors.warning;
    case 'cable': return colors.accent;
    default: return colors.textMuted;
  }
};

export default function TemplateDetailScreen() {
  const route = useRoute<RouteProp>();
  const navigation = useNavigation<Nav>();
  const { templateId } = route.params;

  const [exercises, setExercises] = useState<TemplateExercise[]>([]);
  const [templateName, setTemplateName] = useState(route.params.templateName);

  // Modal state for rename
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // Modal state for edit defaults
  const [showDefaultsModal, setShowDefaultsModal] = useState(false);
  const [defaultsValue, setDefaultsValue] = useState('');
  const [editingItem, setEditingItem] = useState<TemplateExercise | null>(null);

  const loadExercises = useCallback(() => {
    getTemplateExercises(templateId).then(setExercises);
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
      });
    }
  };

  const handleEditDefaults = (item: TemplateExercise) => {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Edit Sets',
        `Current: ${item.default_sets} sets`,
        (input) => {
          if (!input) return;
          const sets = parseInt(input.trim(), 10);
          if (!isNaN(sets) && sets > 0) {
            updateTemplateExerciseDefaults(item.id, { sets }).then(loadExercises);
          } else {
            Alert.alert('Invalid', 'Enter a number of sets (e.g. 4)');
          }
        },
        'plain-text',
        `${item.default_sets}`,
      );
    } else {
      setEditingItem(item);
      setDefaultsValue(`${item.default_sets}`);
      setShowDefaultsModal(true);
    }
  };

  const handleDefaultsConfirm = () => {
    if (!editingItem) return;
    const sets = parseInt(defaultsValue.trim(), 10);
    if (!isNaN(sets) && sets > 0) {
      setShowDefaultsModal(false);
      updateTemplateExerciseDefaults(editingItem.id, { sets }).then(loadExercises);
    } else {
      Alert.alert('Invalid', 'Enter a number of sets (e.g. 4)');
    }
  };

  const handleRemove = (item: TemplateExercise) => {
    Alert.alert('Remove Exercise', `Remove "${item.exercise?.name}" from template?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeExerciseFromTemplate(item.id).then(loadExercises),
      },
    ]);
  };

  const renderItem = ({ item }: { item: TemplateExercise }) => (
    <View style={styles.card}>
      <View style={[styles.cardAccent, { backgroundColor: exerciseTypeColor(item.exercise?.type) }]} />
      <TouchableOpacity style={styles.cardBody} onPress={() => handleEditDefaults(item)} activeOpacity={0.7}>
        <Text style={styles.exerciseName}>{item.exercise?.name ?? 'Unknown'}</Text>
        <Text style={styles.defaults}>
          {item.default_sets} sets
        </Text>
        {item.exercise?.muscle_groups && item.exercise.muscle_groups.length > 0 && (
          <Text style={styles.muscles}>{item.exercise.muscle_groups.join(', ')}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemove(item)}>
        <Ionicons name="trash-outline" size={18} color={colors.error} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.nameRow} onPress={handleEditName} activeOpacity={0.7}>
        <Text style={styles.nameLabel}>TEMPLATE NAME</Text>
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
      >
        <Ionicons name="add-circle-outline" size={20} color={colors.primary} style={{ marginRight: spacing.sm }} />
        <Text style={styles.addBtnText}>Add Exercise</Text>
      </TouchableOpacity>

      {/* Rename Modal */}
      <Modal visible={showRenameModal} transparent animationType="fade">
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowRenameModal(false)}>
            <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
              <Text style={styles.modalTitle}>Rename Template</Text>
              <TextInput
                style={styles.modalInput}
                value={renameValue}
                onChangeText={setRenameValue}
                placeholder="Template name"
                placeholderTextColor={colors.textMuted}
                autoFocus
                onSubmitEditing={handleRenameConfirm}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity onPress={() => setShowRenameModal(false)} style={styles.modalCancelBtn}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleRenameConfirm} style={styles.modalConfirmBtn}>
                  <Text style={styles.modalConfirmText}>Save</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* Defaults Modal */}
      <Modal visible={showDefaultsModal} transparent animationType="fade">
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDefaultsModal(false)}>
            <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
              <Text style={styles.modalTitle}>Edit Defaults</Text>
              <Text style={styles.modalSub}>Number of sets</Text>
              <TextInput
                style={styles.modalInput}
                value={defaultsValue}
                onChangeText={setDefaultsValue}
                placeholder="e.g. 4"
                keyboardType="number-pad"
                placeholderTextColor={colors.textMuted}
                autoFocus
                onSubmitEditing={handleDefaultsConfirm}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity onPress={() => setShowDefaultsModal(false)} style={styles.modalCancelBtn}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDefaultsConfirm} style={styles.modalConfirmBtn}>
                  <Text style={styles.modalConfirmText}>Save</Text>
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
  nameLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
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
    alignItems: 'center',
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
  exerciseName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  defaults: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  muscles: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  removeBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
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

  // Modal shared
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    width: '85%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.sm,
  },
  modalSub: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
  },
  modalInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: fontSize.md,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  modalCancelBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  modalConfirmBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
  },
  modalConfirmText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
