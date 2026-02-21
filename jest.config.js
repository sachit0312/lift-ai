module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@supabase/.*|react-native-url-polyfill)',
  ],
  moduleNameMapper: {
    '^expo-sqlite$': '<rootDir>/src/__mocks__/expo-sqlite.ts',
    '^@sentry/react-native$': '<rootDir>/src/__mocks__/@sentry/react-native.ts',
    '^expo-live-activity$': '<rootDir>/src/__mocks__/expo-live-activity.ts',
    '^expo-notifications$': '<rootDir>/src/__mocks__/expo-notifications.ts',
    '^expo-updates$': '<rootDir>/src/__mocks__/expo-updates.ts',
  },
  testPathIgnorePatterns: ['/node_modules/', 'src/__tests__/helpers/', '.worktrees/'],
  modulePathIgnorePatterns: ['<rootDir>/.worktrees/'],
  clearMocks: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
