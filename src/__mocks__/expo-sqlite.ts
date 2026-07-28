// Real SQLite rejects a transaction started inside another transaction, but a mock that just
// invokes the callback happily runs nested calls — so a regression like calling a helper that
// opens its own withTransactionAsync (clearLocalUpcomingWorkout, deleteWorkout, deleteTemplate)
// from inside an outer transaction would pass every test and only fail on a device.
// This flag reproduces that rejection so the suite catches it.
let inTransaction = false;

const mockDb = {
  getAllAsync: jest.fn().mockResolvedValue([]),
  getFirstAsync: jest.fn().mockResolvedValue(null),
  runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
  execAsync: jest.fn().mockResolvedValue(undefined),
  withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => {
    if (inTransaction) {
      throw new Error('cannot start a transaction within a transaction');
    }
    inTransaction = true;
    try {
      await cb();
    } finally {
      inTransaction = false;
    }
  }),
  closeAsync: jest.fn().mockResolvedValue(undefined),
};

export function openDatabaseAsync() {
  return Promise.resolve(mockDb);
}

export function deleteDatabaseAsync() {
  return Promise.resolve(undefined);
}

export const __mockDb = mockDb;

/** Clears the nesting flag between tests, so a test that deliberately throws mid-transaction
 *  cannot leak `inTransaction = true` into the next one. */
export function __resetTransactionState() {
  inTransaction = false;
}
