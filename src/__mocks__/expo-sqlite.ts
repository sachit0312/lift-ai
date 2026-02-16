const mockDb = {
  getAllAsync: jest.fn().mockResolvedValue([]),
  getFirstAsync: jest.fn().mockResolvedValue(null),
  runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
  execAsync: jest.fn().mockResolvedValue(undefined),
  withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => cb()),
};

export function openDatabaseAsync() {
  return Promise.resolve(mockDb);
}

export const __mockDb = mockDb;
