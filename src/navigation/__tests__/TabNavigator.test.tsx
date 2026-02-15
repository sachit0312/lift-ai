import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';

// Mock all screen components as lightweight placeholders
jest.mock('../../screens/WorkoutScreen', () => {
  const { Text } = require('react-native');
  return () => <Text>WorkoutContent</Text>;
});
jest.mock('../../screens/TemplatesScreen', () => {
  const { Text } = require('react-native');
  return () => <Text>TemplatesContent</Text>;
});
jest.mock('../../screens/TemplateDetailScreen', () => {
  const { Text } = require('react-native');
  return () => <Text>TemplateDetailContent</Text>;
});
jest.mock('../../screens/ExercisePickerScreen', () => {
  const { Text } = require('react-native');
  return () => <Text>ExercisePickerContent</Text>;
});
jest.mock('../../screens/HistoryScreen', () => {
  const { Text } = require('react-native');
  return () => <Text>HistoryContent</Text>;
});
jest.mock('../../screens/ProfileScreen', () => {
  const { Text } = require('react-native');
  return () => <Text>ProfileContent</Text>;
});
jest.mock('../../screens/ExercisesScreen', () => {
  const { Text } = require('react-native');
  return () => <Text>ExercisesContent</Text>;
});

import TabNavigator from '../TabNavigator';

const renderTabNavigator = () =>
  render(
    <NavigationContainer>
      <TabNavigator />
    </NavigationContainer>
  );

describe('TabNavigator', () => {
  it('renders all 5 tab labels', () => {
    const { getByText } = renderTabNavigator();

    expect(getByText('Workout')).toBeTruthy();
    expect(getByText('Templates')).toBeTruthy();
    expect(getByText('Exercises')).toBeTruthy();
    expect(getByText('History')).toBeTruthy();
    expect(getByText('Profile')).toBeTruthy();
  });

  it('defaults to Workout tab', () => {
    const { getByText } = renderTabNavigator();

    expect(getByText('WorkoutContent')).toBeTruthy();
  });

  it('switches to Templates tab on press', async () => {
    const { getByText } = renderTabNavigator();

    fireEvent.press(getByText('Templates'));

    await waitFor(() => {
      expect(getByText('TemplatesContent')).toBeTruthy();
    });
  });

  it('switches to Exercises tab on press', async () => {
    const { getByText } = renderTabNavigator();

    fireEvent.press(getByText('Exercises'));

    await waitFor(() => {
      expect(getByText('ExercisesContent')).toBeTruthy();
    });
  });

  it('switches to History tab on press', async () => {
    const { getByText } = renderTabNavigator();

    fireEvent.press(getByText('History'));

    await waitFor(() => {
      expect(getByText('HistoryContent')).toBeTruthy();
    });
  });

  it('switches to Profile tab on press', async () => {
    const { getByText } = renderTabNavigator();

    fireEvent.press(getByText('Profile'));

    await waitFor(() => {
      expect(getByText('ProfileContent')).toBeTruthy();
    });
  });
});
