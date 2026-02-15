import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Alert, StyleSheet, Platform,
  Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TemplatesStackParamList } from '../navigation/TabNavigator';
import { colors, spacing, fontSize, fontWeight, borderRadius, modalStyles } from '../theme';
import { getAllTemplates, createTemplate, deleteTemplate, getTemplateExerciseCount } from '../services/database';
import type { Template } from '../types/database';

interface TemplateWithCount extends Template {
  exerciseCount: number;
}

type Nav = NativeStackNavigationProp<TemplatesStackParamList, 'TemplatesList'>;

export default function TemplatesScreen() {
  const navigation = useNavigation<Nav>();
  const [templates, setTemplates] = useState<TemplateWithCount[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  const loadTemplates = useCallback(() => {
    getAllTemplates().then(async (ts) => {
      const withCounts = await Promise.all(
        ts.map(async (t) => ({
          ...t,
          exerciseCount: await getTemplateExerciseCount(t.id),
        })),
      );
      setTemplates(withCounts);
    }).catch((e) => console.error('Failed to load templates', e));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTemplates();
    }, [loadTemplates]),
  );

  const handleCreate = () => {
    if (Platform.OS === 'ios') {
      Alert.prompt('New Template', 'Enter a name', (name) => {
        if (name && name.trim()) {
          createTemplate(name.trim()).then((t) => {
            navigation.navigate('TemplateDetail', { templateId: t.id, templateName: t.name });
          }).catch((e) => console.error('Failed to create template', e));
        }
      });
    } else {
      setNewTemplateName('');
      setShowCreateModal(true);
    }
  };

  const handleCreateConfirm = () => {
    const name = newTemplateName.trim() || 'Untitled Template';
    setShowCreateModal(false);
    createTemplate(name).then((t) => {
      navigation.navigate('TemplateDetail', { templateId: t.id, templateName: t.name });
    }).catch((e) => console.error('Failed to create template', e));
  };

  const handleLongPress = useCallback((template: Template) => {
    Alert.alert('Delete Template', `Delete "${template.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteTemplate(template.id).then(loadTemplates).catch((e) => console.error('Failed to delete template', e));
        },
      },
    ]);
  }, [loadTemplates]);

  const renderItem = useCallback(({ item }: { item: TemplateWithCount }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('TemplateDetail', { templateId: item.id, templateName: item.name })}
      onLongPress={() => handleLongPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.cardLeft} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{item.name}</Text>
        <Text style={styles.cardSub}>
          {item.exerciseCount} exercise{item.exerciseCount !== 1 ? 's' : ''} · Updated {new Date(item.updated_at).toLocaleDateString()}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  ), [navigation, handleLongPress]);

  return (
    <View style={styles.container}>
      <FlatList
        data={templates}
        keyExtractor={(t) => t.id}
        renderItem={renderItem}
        contentContainerStyle={templates.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="documents-outline" size={64} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No Templates Yet</Text>
            <Text style={styles.emptySub}>
              Create your first workout template to get started.
            </Text>
          </View>
        }
      />
      <TouchableOpacity style={styles.fab} onPress={handleCreate} activeOpacity={0.8} testID="create-template-fab">
        <Ionicons name="add" size={28} color={colors.white} />
      </TouchableOpacity>

      <Modal visible={showCreateModal} transparent animationType="fade" onRequestClose={() => setShowCreateModal(false)}>
        <KeyboardAvoidingView behavior="padding" style={modalStyles.overlay}>
          <TouchableOpacity style={modalStyles.overlay} activeOpacity={1} onPress={() => setShowCreateModal(false)}>
            <TouchableOpacity activeOpacity={1} style={modalStyles.card}>
              <Text style={modalStyles.title}>New Template</Text>
              <TextInput
                style={modalStyles.input}
                value={newTemplateName}
                onChangeText={setNewTemplateName}
                placeholder="Template name"
                placeholderTextColor={colors.textMuted}
                autoFocus
                onSubmitEditing={handleCreateConfirm}
                testID="template-name-input"
              />
              <View style={modalStyles.actions}>
                <TouchableOpacity style={modalStyles.cancelBtn} onPress={() => setShowCreateModal(false)}>
                  <Text style={modalStyles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[modalStyles.confirmBtn, { backgroundColor: colors.primary }]} onPress={handleCreateConfirm} testID="template-create-btn">
                  <Text style={modalStyles.confirmText}>Create</Text>
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
  emptyTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginTop: spacing.lg,
  },
  emptySub: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  cardLeft: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: colors.primaryDim,
  },
  cardBody: {
    flex: 1,
    padding: spacing.md,
    paddingLeft: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  cardSub: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
});
