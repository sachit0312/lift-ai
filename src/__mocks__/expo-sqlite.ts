const mockDb = {
  getAllAsync: jest.fn().mockResolvedValue([]),
  runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
  execAsync: jest.fn().mockResolvedValue(undefined),
};

export function openDatabaseAsync() {
  return Promise.resolve(mockDb);
}

export const __mockDb = mockDb;
