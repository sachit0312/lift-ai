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

// Test helper to reset the store
export function __resetStore() {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
}
