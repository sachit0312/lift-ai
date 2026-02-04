import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from '../services/supabase';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import type { AuthStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleEmailLogin = async () => {
    if (!email || !password) {
      setError('Please enter email and password.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setError('');
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) {
      setError(authError.message);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      // For native builds, use the native scheme directly with a path
      const redirectTo = Platform.select({
        ios: 'workout-enhanced://auth/callback',
        android: 'workout-enhanced://auth/callback',
        default: makeRedirectUri({ scheme: 'workout-enhanced' }),
      });
      if (__DEV__) console.log('[OAuth] Redirect URI:', redirectTo);

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });

      if (__DEV__) console.log('[OAuth] Supabase response:', { hasUrl: !!data?.url, error: oauthError });

      if (oauthError) {
        if (__DEV__) console.error('[OAuth] Supabase error:', oauthError);
        setError(oauthError.message);
        setGoogleLoading(false);
        return;
      }

      if (data?.url) {
        if (__DEV__) console.log('[OAuth] Opening browser with URL');
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (__DEV__) console.log('[OAuth] Browser result:', result);

        if (result.type === 'success') {
          if (__DEV__) console.log('[OAuth] Success! URL:', result.url);
          const url = result.url;
          const fragment = url.split('#')[1];
          const query = url.split('?')[1]?.split('#')[0];

          if (__DEV__) console.log('[OAuth] Fragment:', fragment, 'Query:', query);

          if (fragment) {
            const params = new URLSearchParams(fragment);
            const access_token = params.get('access_token');
            const refresh_token = params.get('refresh_token');
            if (__DEV__) console.log('[OAuth] Tokens from fragment:', { hasAccess: !!access_token, hasRefresh: !!refresh_token });

            if (access_token && refresh_token) {
              if (__DEV__) console.log('[OAuth] Setting session');
              await supabase.auth.setSession({ access_token, refresh_token });
            } else {
              throw new Error('Tokens not found in URL fragment');
            }
          } else if (query) {
            const params = new URLSearchParams(query);
            const access_token = params.get('access_token');
            const refresh_token = params.get('refresh_token');
            if (__DEV__) console.log('[OAuth] Tokens from query:', { hasAccess: !!access_token, hasRefresh: !!refresh_token });

            if (access_token && refresh_token) {
              if (__DEV__) console.log('[OAuth] Setting session from query params');
              await supabase.auth.setSession({ access_token, refresh_token });
            } else {
              throw new Error('Tokens not found in URL');
            }
          } else {
            throw new Error('No fragment or query params in redirect URL');
          }
        } else if (result.type === 'cancel') {
          if (__DEV__) console.log('[OAuth] User cancelled');
          throw new Error('Sign in cancelled');
        } else {
          if (__DEV__) console.log('[OAuth] Unexpected result type:', result.type);
          throw new Error('Unexpected OAuth result');
        }
      }
    } catch (e: any) {
      if (__DEV__) console.error('[OAuth] Exception:', e);
      setError(e.message ?? 'Google sign-in failed.');
    }
    setGoogleLoading(false);
  };

  const isLoading = loading || googleLoading;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.logoContainer}>
          <Ionicons name="barbell" size={64} color={colors.primary} />
        </View>

        <Text style={styles.title}>Welcome Back</Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!isLoading}
          testID="login-email"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!isLoading}
          testID="login-password"
        />

        <TouchableOpacity
          style={[styles.loginButton, isLoading && styles.disabledButton]}
          onPress={handleEmailLogin}
          disabled={isLoading}
          testID="login-btn"
        >
          {loading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.loginButtonText}>Log In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.googleButton, isLoading && styles.disabledButton]}
          onPress={handleGoogleLogin}
          disabled={isLoading}
        >
          {googleLoading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <View style={styles.googleButtonContent}>
              <Ionicons name="logo-google" size={20} color={colors.background} />
              <Text style={styles.googleButtonText}>Sign in with Google</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.signupLink}
          onPress={() => navigation.navigate('Signup')}
          disabled={isLoading}
        >
          <Text style={styles.signupText}>
            Don't have an account? <Text style={styles.signupTextBold}>Sign Up</Text>
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  loginButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  loginButtonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  googleButton: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  googleButtonText: {
    color: colors.background,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  disabledButton: {
    opacity: 0.6,
  },
  signupLink: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  signupText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  signupTextBold: {
    color: colors.primary,
    fontWeight: fontWeight.semibold,
  },
});
