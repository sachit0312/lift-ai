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
import { supabase } from '../services/supabase';
import { colors, spacing, fontSize, fontWeight, borderRadius, authStyles } from '../theme';
import type { AuthStackParamList } from '../navigation/RootNavigator';
import { EMAIL_REGEX } from '../constants/validation';

type Props = NativeStackScreenProps<AuthStackParamList, 'Signup'>;

export default function SignupScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleSignup = async () => {
    if (!email || !password || !confirmPassword) {
      setError('Please fill in all fields.');
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
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setLoading(true);
    const { error: authError } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (authError) {
      setError(authError.message);
    } else {
      setSignupSuccess(true);
    }
  };

  return (
    <SafeAreaView style={authStyles.container}>
      <KeyboardAvoidingView
        style={authStyles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {signupSuccess ? (
          <View style={styles.successContainer} testID="signup-success">
            <Ionicons name="checkmark-circle" size={64} color={colors.success} />
            <Text style={styles.successTitle}>Check Your Email</Text>
            <Text style={styles.successMessage}>
              We sent a verification link to {email}. Please check your inbox to verify your account.
            </Text>
            <TouchableOpacity
              style={styles.backToLoginButton}
              onPress={() => navigation.navigate('Login')}
            >
              <Text style={authStyles.primaryButtonText}>Back to Login</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={authStyles.logoContainer}>
              <Ionicons name="barbell" size={48} color={colors.primary} />
            </View>

            <Text style={authStyles.title}>Create Account</Text>

            {error ? <Text style={authStyles.errorText}>{error}</Text> : null}

            <TextInput
              style={authStyles.input}
              placeholder="Email"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!loading}
              testID="signup-email"
            />

            <TextInput
              style={authStyles.input}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
              testID="signup-password"
            />

            <TextInput
              style={authStyles.input}
              placeholder="Confirm Password"
              placeholderTextColor={colors.textMuted}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              editable={!loading}
              testID="signup-confirm"
            />

            <TouchableOpacity
              style={[authStyles.primaryButton, loading && authStyles.disabledButton]}
              onPress={handleSignup}
              disabled={loading}
              testID="signup-btn"
            >
              {loading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={authStyles.primaryButtonText}>Create Account</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={authStyles.switchLink}
              onPress={() => navigation.navigate('Login')}
              disabled={loading}
            >
              <Text style={authStyles.switchText}>
                Already have an account? <Text style={authStyles.switchTextBold}>Log In</Text>
              </Text>
            </TouchableOpacity>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  successContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  successTitle: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  successMessage: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  backToLoginButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
});
