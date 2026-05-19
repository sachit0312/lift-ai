/**
 * Tests for Batch 4 Task 1: handleDragEnd must snapshot the live `exercises`
 * via a ref so rollback after a failed reorder doesn't clobber an intervening
 * stepper write that succeeded.
 *
 * We don't render the full screen (it depends on navigation, drag library,
 * many services) — instead we test the contract that a ref captured BEFORE
 * the awaited reorder must hold the latest state at the time of rollback,
 * not a stale closure snapshot.
 */
import { useRef, useState } from 'react';

describe('Batch 4 Task 1: drag rollback ref contract', () => {
  it('models the bug: closure-captured previous discards intervening updates', () => {
    let exercises = [{ id: 'a', sets: 3 }, { id: 'b', sets: 3 }];
    const setExercises = (next: typeof exercises) => { exercises = next; };

    // User starts drag — handler captures `previous` via closure
    const previous = exercises;

    // Drag completes, optimistic update
    setExercises([{ id: 'b', sets: 3 }, { id: 'a', sets: 3 }]);

    // BEFORE the reorder write fails, a stepper increments b's sets
    setExercises(exercises.map(e => e.id === 'b' ? { ...e, sets: 4 } : e));

    // Reorder fails → rollback via closure-captured snapshot
    setExercises(previous);

    // BUG: the stepper change (b.sets = 4) was lost
    const b = exercises.find(e => e.id === 'b')!;
    expect(b.sets).toBe(3);  // <- the closure-captured rollback reverted to 3
  });

  it('models the fix: ref-based snapshot rolls back only the order, preserving intervening data changes', () => {
    let exercises = [{ id: 'a', sets: 3 }, { id: 'b', sets: 3 }];
    const exercisesRef = { current: exercises };
    const setExercises = (next: typeof exercises) => {
      exercises = next;
      exercisesRef.current = next;
    };

    // The fix snapshots the ORDER, not the full state.
    const previousOrder = exercisesRef.current.map(e => e.id);

    setExercises([{ id: 'b', sets: 3 }, { id: 'a', sets: 3 }]);

    // Intervening stepper update on b
    setExercises(exercisesRef.current.map(e => e.id === 'b' ? { ...e, sets: 4 } : e));

    // Reorder fails → rollback to previous order, preserving live data
    const byId = new Map(exercisesRef.current.map(e => [e.id, e]));
    setExercises(previousOrder.map(id => byId.get(id)!));

    // FIX: b.sets stays at 4 because the rollback only restored order
    const b = exercises.find(e => e.id === 'b')!;
    expect(b.sets).toBe(4);
    expect(exercises.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('grep invariant: TemplateDetailScreen.handleDragEnd uses a ref-based rollback', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../screens/TemplateDetailScreen.tsx'),
      'utf8',
    );
    // The fix introduces an `exercisesRef` and uses it inside handleDragEnd's
    // rollback path instead of closure-captured `exercises`.
    expect(src).toMatch(/exercisesRef/);
    expect(src).toMatch(/handleDragEnd[^]*?exercisesRef\.current/);
  });
});
