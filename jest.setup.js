// Shared mock for @expo/vector-icons
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: (props) => React.createElement(Text, props, props.name),
  };
});

// Shared mock for react-native-chart-kit
jest.mock('react-native-chart-kit', () => ({
  LineChart: () => null,
}));

// Silence console.error for expected test warnings
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (args[0]?.includes?.('Warning:')) return;
    originalError.call(console, ...args);
  };
});
afterAll(() => {
  console.error = originalError;
});
