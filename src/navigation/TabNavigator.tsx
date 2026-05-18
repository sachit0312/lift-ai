import React, { Suspense } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize } from '../theme';
// Workout is the default tab — keep eager so cold-start renders the first frame immediately.
import WorkoutScreen from '../screens/WorkoutScreen';
import TemplatesScreen from '../screens/TemplatesScreen';
import TemplateDetailScreen from '../screens/TemplateDetailScreen';
import ExercisePickerScreen from '../screens/ExercisePickerScreen';

// Lazy: these tabs pull heavy transitive deps (chart-kit, etc.) that don't need
// to parse at boot. React.lazy with a Suspense fallback shifts the cost to first
// activation of each tab.
const HistoryScreen = React.lazy(() => import('../screens/HistoryScreen'));
const ProfileScreen = React.lazy(() => import('../screens/ProfileScreen'));
const ExercisesScreen = React.lazy(() => import('../screens/ExercisesScreen'));

function TabScreenFallback() {
  return (
    <View style={fallbackStyles.center}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const fallbackStyles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});

// Wrap a lazy screen with Suspense so each tab can be loaded independently.
// React Navigation's tab routes mount the component eagerly when the tab is
// selected; Suspense yields a fallback frame while the chunk parses.
function lazyTabScreen<P extends object>(Component: React.LazyExoticComponent<React.ComponentType<P>>): React.ComponentType<P> {
  return function LazyTabScreen(props: P) {
    return (
      <Suspense fallback={<TabScreenFallback />}>
        <Component {...props} />
      </Suspense>
    );
  };
}

const HistoryTab = lazyTabScreen(HistoryScreen);
const ProfileTab = lazyTabScreen(ProfileScreen);
const ExercisesTab = lazyTabScreen(ExercisesScreen);

export type TemplatesStackParamList = {
  TemplatesList: undefined;
  TemplateDetail: { templateId: string; templateName: string };
  ExercisePicker: { templateId: string };
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<TemplatesStackParamList>();

function TemplatesStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontSize: fontSize.lg },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="TemplatesList"
        component={TemplatesScreen}
        options={{ title: 'Templates' }}
      />
      <Stack.Screen
        name="TemplateDetail"
        component={TemplateDetailScreen}
        options={({ route }) => ({ title: route.params.templateName })}
      />
      <Stack.Screen
        name="ExercisePicker"
        component={ExercisePickerScreen}
        options={{ title: 'Add Exercise' }}
      />
    </Stack.Navigator>
  );
}

const tabIcon = (route: string, focused: boolean): keyof typeof Ionicons.glyphMap => {
  const icons: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
    Workout: ['barbell', 'barbell-outline'],
    Templates: ['documents', 'documents-outline'],
    Exercises: ['fitness', 'fitness-outline'],
    History: ['time', 'time-outline'],
    Profile: ['person', 'person-outline'],
  };
  const [active, inactive] = icons[route] ?? ['ellipse', 'ellipse-outline'];
  return focused ? active : inactive;
};

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, size }) => (
          <Ionicons
            name={tabIcon(route.name, focused)}
            size={size}
            color={focused ? colors.primary : colors.textMuted}
          />
        ),
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontSize: fontSize.xs,
        },
      })}
    >
      <Tab.Screen name="Workout" component={WorkoutScreen} />
      <Tab.Screen name="Templates" component={TemplatesStack} />
      <Tab.Screen name="Exercises" component={ExercisesTab} />
      <Tab.Screen name="History" component={HistoryTab} />
      <Tab.Screen name="Profile" component={ProfileTab} />
    </Tab.Navigator>
  );
}
