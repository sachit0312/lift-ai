import * as Sentry from '@sentry/react-native';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import { NavigationContainer, DefaultTheme, NavigationState } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from './src/contexts/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { colors } from './src/theme';

if (__DEV__) {
  LogBox.ignoreLogs([
    'Sync exercises error',
    'Sync templates error',
    'Sync workout',
    'Pull upcoming',
    'Failed to load',
    'Failed to start',
    'pullUpcomingWorkout failed',
    'syncToSupabase failed',
  ]);
}

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: __DEV__ ? 1.0 : 0.2,
  debug: __DEV__,
});

const getActiveRouteName = (state: NavigationState | undefined): string | undefined => {
  if (!state) return undefined;
  const route = state.routes[state.index];
  if (route.state) {
    return getActiveRouteName(route.state as NavigationState);
  }
  return route.name;
};

const handleNavigationStateChange = (state: NavigationState | undefined): void => {
  const routeName = getActiveRouteName(state);
  if (routeName) {
    Sentry.addBreadcrumb({
      category: 'navigation',
      message: `Navigated to ${routeName}`,
      level: 'info',
    });
  }
};

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
};

const linking = {
  prefixes: ['liftai://'],
  config: {
    screens: {
      Workout: 'workout',
    },
  },
};

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <AuthProvider>
            <NavigationContainer
              theme={navTheme}
              onStateChange={handleNavigationStateChange}
              linking={linking}
            >
              <RootNavigator />
              <StatusBar style="light" />
            </NavigationContainer>
          </AuthProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(App);
