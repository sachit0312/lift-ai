import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

const SharedUserDefaultsNative = Platform.OS === 'ios'
  ? requireNativeModule('SharedUserDefaults')
  : null;

export function setItem(key: string, value: string): void {
  SharedUserDefaultsNative?.setItem(key, value);
}

export function getItem(key: string): string | null {
  return SharedUserDefaultsNative?.getItem(key) ?? null;
}

export function removeItem(key: string): void {
  SharedUserDefaultsNative?.removeItem(key);
}
