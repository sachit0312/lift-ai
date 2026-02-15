import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'workout-enhanced',
  slug: 'workout-enhanced',
  scheme: 'workout-enhanced',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  newArchEnabled: true,
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#09090B',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.anonymous.workout-enhanced',
    infoPlist: {
      NSSupportsLiveActivities: true,
      NSSupportsLiveActivitiesFrequentUpdates: true,
    },
  },
  android: {
    package: 'com.anonymous.workoutenhanced',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#09090B',
    },
    edgeToEdgeEnabled: true,
    // @ts-ignore — Expo SDK 54 supports this but types may lag
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-sqlite',
    'expo-secure-store',
    'expo-web-browser',
    'expo-live-activity',
    [
      '@sentry/react-native/expo',
      {
        organization: process.env.SENTRY_ORG || 'sachit-goyal',
        project: process.env.SENTRY_PROJECT || 'react-native',
      },
    ],
    './plugins/withLocalNotificationsOnly',
  ],
});
