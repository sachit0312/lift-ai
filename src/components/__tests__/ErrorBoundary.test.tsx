import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
}));

import { ErrorBoundary } from '../ErrorBoundary';
import * as Sentry from '@sentry/react-native';

// Control whether component should throw via a mutable ref
let shouldThrowError = false;

const ThrowingComponent = () => {
  if (shouldThrowError) throw new Error('Test error');
  return <Text>Child rendered</Text>;
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrowError = false;
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
    shouldThrowError = false;
  });

  it('renders children when no error', () => {
    shouldThrowError = false;
    const { getByText } = render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(getByText('Child rendered')).toBeTruthy();
  });

  it('renders error UI when child throws', () => {
    shouldThrowError = true;
    const { getByText } = render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(getByText(/something went wrong/i)).toBeTruthy();
    expect(getByText('Try Again')).toBeTruthy();
  });

  it('reports error to Sentry', () => {
    shouldThrowError = true;
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('resets error state on Try Again press', () => {
    shouldThrowError = true;

    const { getByText, rerender, queryByText } = render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    // Should show error UI
    expect(getByText(/something went wrong/i)).toBeTruthy();

    // Stop throwing and press Try Again
    shouldThrowError = false;
    fireEvent.press(getByText('Try Again'));

    // Force rerender to pick up the state change
    rerender(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    // Should now show the child
    expect(getByText('Child rendered')).toBeTruthy();
    expect(queryByText(/something went wrong/i)).toBeNull();
  });
});
