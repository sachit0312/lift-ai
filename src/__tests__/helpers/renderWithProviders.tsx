import React from 'react';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';

/**
 * Wraps component in NavigationContainer for tests.
 * Mock AuthContext and other providers at the test-file level via jest.mock.
 */
export function renderWithProviders(ui: React.ReactElement) {
  return render(
    <NavigationContainer>{ui}</NavigationContainer>,
  );
}
