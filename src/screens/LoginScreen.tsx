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
import { colors, spacing, fontSize, fontWeight, borderRadius, layout, authStyles } from '../theme';
import type { AuthStackParamList } from '../navigation/RootNavigator';
import { EMAIL_REGEX } from '../constants/validation';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

function extractOAuthTokens(url: string): { access_token: string; refresh_token: string } {
  const fragment = url.split('#')[1];
  const query = url.split('?')[1]?.split('#')[0];
  const raw = fragment || query;

  if (!raw) {
    throw new Error('No fragment or query params in redirect URL');
  }

  const params = new URLSearchParams(raw);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');

  if (__DEV__) {
    const source = fragment ? 'fragment' : 'query';
    console.log(`[OAuth] Tokens from ${source}:`, { hasAccess: !!access_token, hasRefresh: !!refresh_token });
  }

  if (!access_token || !refresh_token) {
    throw new Error('Tokens not found in URL');
  }

  return { access_token, refresh_token };
}

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Please enter your email address first.');
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setError('');
    setResetSent(false);
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (resetError) {
        setError(resetError.message);
      } else {
        setResetSent(true);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send reset email.');
    }
    setLoading(false);
  };

  const handleEmailLogin = async () => {
    if (!email || !password) {
      setError('Please enter email and password.');
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
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
      const redirectTo = Platform.select({
        ios: 'liftai://auth/callback',
        android: 'liftai://auth/callback',
        default: makeRedirectUri({ scheme: 'liftai' }),
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
          const tokens = extractOAuthTokens(result.url);
          if (__DEV__) console.log('[OAuth] Setting session');
          await supabase.auth.setSession(tokens);
        } else if (result.type === 'cancel') {
          if (__DEV__) console.log('[OAuth] User cancelled');
          throw new Error('Sign in cancelled');
        } else {
          if (__DEV__) console.log('[OAuth] Unexpected result type:', result.type);
          throw new Error('Unexpected OAuth result');
        }
      }
    } catch (e: unknown) {
      if (__DEV__) console.error('[OAuth] Exception:', e);
      setError(e instanceof Error ? e.message : 'Google sign-in failed.');
    }
    setGoogleLoading(false);
  };

  const isLoading = loading || googleLoading;

  return (
    <SafeAreaView style={authStyles.container}>
      <KeyboardAvoidingView
        style={authStyles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={authStyles.logoContainer}>
          <Ionicons name="barbell" size={48} color={colors.primary} />
        </View>

        <Text style={authStyles.title}>Welcome Back</Text>

        {error ? <Text style={authStyles.errorText}>{error}</Text> : null}
        {resetSent ? (
          <Text style={styles.resetSentText}>Password reset email sent. Check your inbox.</Text>
        ) : null}

        <TextInput
          style={authStyles.input}
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
          style={authStyles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!isLoading}
          testID="login-password"
        />

        <TouchableOpacity
          style={styles.forgotPasswordLink}
          onPress={handleForgotPassword}
          disabled={isLoading}
          testID="forgot-password-btn"
        >
          <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[authStyles.primaryButton, isLoading && authStyles.disabledButton]}
          onPress={handleEmailLogin}
          disabled={isLoading}
          testID="login-btn"
        >
          {loading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={authStyles.primaryButtonText}>Log In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.googleButton, isLoading && authStyles.disabledButton]}
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
          style={authStyles.switchLink}
          onPress={() => navigation.navigate('Signup')}
          disabled={isLoading}
        >
          <Text style={authStyles.switchText}>
            Don't have an account? <Text style={authStyles.switchTextBold}>Sign Up</Text>
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  resetSentText: {
    color: colors.success,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  forgotPasswordLink: {
    alignSelf: 'flex-end',
    marginBottom: spacing.sm,
    paddingVertical: spacing.md,
  },
  forgotPasswordText: {
    color: colors.primary,
    fontSize: fontSize.sm,
  },
  googleButton: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
    minHeight: layout.buttonHeight,
    justifyContent: 'center',
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
});
