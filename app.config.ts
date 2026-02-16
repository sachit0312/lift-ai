import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'lift.ai',
  slug: 'lift-ai',
  scheme: 'liftai',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  newArchEnabled: true,
  owner: 'sachitgoyal',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#09090B',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.sachitgoyal.liftai',
    infoPlist: {
      NSSupportsLiveActivities: true,
      NSSupportsLiveActivitiesFrequentUpdates: true,
    },
  },
  android: {
    package: 'com.sachitgoyal.liftai',
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
  updates: {
    url: 'https://u.expo.dev/405310db-a7c7-4d03-9f82-81a752ede55d',
  },
  runtimeVersion: {
    policy: 'fingerprint',
  },
  extra: {
    eas: {
      projectId: '405310db-a7c7-4d03-9f82-81a752ede55d',
    },
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
