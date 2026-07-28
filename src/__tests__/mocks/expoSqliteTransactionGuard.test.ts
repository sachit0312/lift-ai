/**
 * Contract test for the expo-sqlite mock's transaction nesting guard.
 *
 * Real SQLite rejects `BEGIN` inside an open transaction. Several helpers in database.ts open
 * their own transaction (clearLocalUpcomingWorkout, deleteWorkout, deleteTemplate,
 * insertSkippedPlaceholderSets), so calling one of them from inside another transaction is a
 * live hazard — sync.ts's pullUpcomingWorkout inlines three DELETEs specifically to avoid it.
 *
 * Without a guard the mock would run nested calls happily and that regression would only
 * appear on a device. This test exists so the guard itself can't silently stop working: if it
 * ever passes vacuously, the whole safety net is gone and nothing else would notice.
 */
import { __mockDb, __resetTransactionState } from '../../__mocks__/expo-sqlite';

describe('expo-sqlite mock: transaction nesting guard', () => {
  beforeEach(() => {
    __resetTransactionState();
  });

  it('rejects a transaction started inside another transaction', async () => {
    await expect(
      __mockDb.withTransactionAsync(async () => {
        await __mockDb.withTransactionAsync(async () => { /* nested — must throw */ });
      }),
    ).rejects.toThrow(/cannot start a transaction within a transaction/);
  });

  it('allows sequential (non-nested) transactions', async () => {
    await __mockDb.withTransactionAsync(async () => { /* first */ });
    await expect(
      __mockDb.withTransactionAsync(async () => { /* second */ }),
    ).resolves.toBeUndefined();
  });

  it('clears the flag when a transaction body throws, so later transactions still work', async () => {
    await expect(
      __mockDb.withTransactionAsync(async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');

    await expect(
      __mockDb.withTransactionAsync(async () => { /* must not be blocked by the failure above */ }),
    ).resolves.toBeUndefined();
  });
});
