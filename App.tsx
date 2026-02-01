import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import TabNavigator from './src/navigation/TabNavigator';
import { colors } from './src/theme';

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

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <TabNavigator />
      <StatusBar style="light" />
    </NavigationContainer>
  );
}
