const store: Record<string, string> = {};

export const setItem = jest.fn((key: string, value: string) => {
  store[key] = value;
});

export const getItem = jest.fn((key: string): string | null => {
  return store[key] ?? null;
});

export const removeItem = jest.fn((key: string) => {
  delete store[key];
});

export const getItemAndRemove = jest.fn((key: string): string | null => {
  const value = store[key] ?? null;
  delete store[key];
  return value;
});

// Test helper to reset the store
export function __resetStore() {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
}
