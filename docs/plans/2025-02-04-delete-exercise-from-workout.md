# Delete Exercise from Active Workout

## Summary

Allow users to remove an entire exercise from an active workout via an X button in the action row.

## UI Design

**Action row layout:**
```
[ Add Set ]  [ Notes ]  [X]
```

- X button positioned after Notes button
- Muted icon color (matches rest timer controls)
- Red tint on press for visual feedback

## Interaction Flow

1. User taps X button on exercise block
2. Alert appears: "Remove [Exercise Name]?"
   - Cancel button (left)
   - Remove button (right, destructive style)
3. On confirm:
   - All workout_sets for this exercise deleted from SQLite
   - ExerciseBlock removed from local state
   - No undo capability

## Implementation

### New function in WorkoutScreen.tsx

```typescript
const handleRemoveExercise = useCallback(async (blockIdx: number) => {
  const block = exerciseBlocks[blockIdx];

  Alert.alert(
    'Remove Exercise',
    `Remove ${block.exercise.name}?`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          // Delete all sets from database
          for (const set of block.sets) {
            await deleteWorkoutSet(set.id);
          }
          // Remove block from state
          setExerciseBlocks(prev => prev.filter((_, idx) => idx !== blockIdx));
        },
      },
    ]
  );
}, [exerciseBlocks]);
```

### Action row modification

Add X button after Notes button in renderExerciseBlock:

```tsx
<TouchableOpacity
  style={styles.removeExerciseButton}
  onPress={() => handleRemoveExercise(blockIdx)}
>
  <Ionicons name="close" size={20} color={colors.textMuted} />
</TouchableOpacity>
```

### Styles

```typescript
removeExerciseButton: {
  padding: spacing.sm,
  marginLeft: spacing.xs,
},
```

## Scope

- Works for both anonymous workouts and template-based workouts
- Deletes sets completely (no soft delete)
- No impact on the original template if workout was started from one
