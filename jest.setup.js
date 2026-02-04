// Shared mock for @expo/vector-icons
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: (props) => React.createElement(Text, props, props.name),
  };
});

// Shared mock for react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    GestureHandlerRootView: ({ children, ...props }) =>
      React.createElement(View, props, children),
    Swipeable: React.forwardRef(({ children, testID, ...props }, ref) =>
      React.createElement(View, { testID, ...props }, children)),
    PanGestureHandler: ({ children }) => children,
    TapGestureHandler: ({ children }) => children,
    State: {},
    Directions: {},
  };
});

// Mock ReanimatedSwipeable separately (imported from subpath)
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: React.forwardRef(({ children, testID, ...props }, ref) =>
      React.createElement(View, { testID, ...props }, children)),
  };
});

// Shared mock for react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      View: View,
    },
    useAnimatedStyle: () => ({}),
    useSharedValue: (val) => ({ value: val }),
    interpolate: (val, input, output) => output[0],
    withTiming: (val) => val,
    withSpring: (val) => val,
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
