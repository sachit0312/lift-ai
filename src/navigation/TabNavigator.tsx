import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize } from '../theme';
import WorkoutScreen from '../screens/WorkoutScreen';
import TemplatesScreen from '../screens/TemplatesScreen';
import TemplateDetailScreen from '../screens/TemplateDetailScreen';
import ExercisePickerScreen from '../screens/ExercisePickerScreen';
import HistoryScreen from '../screens/HistoryScreen';
import ProfileScreen from '../screens/ProfileScreen';

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
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
