import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { signInWithEmailAndPassword } from '../supabaseConfig';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);
  const navigation = useNavigation<any>();

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Required', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(email.trim(), password);
    } catch (err: any) {
      const map: Record<string, string> = {
        'invalid_credentials': 'Invalid email or password.',
        'email_not_confirmed': 'Please confirm your email before signing in.',
      };
      Alert.alert('Login Failed', map[err.code] ?? err.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand mark */}
          <View style={s.brandContainer}>
            <View style={s.logoBox}>
              <Text style={s.logoText}>CT</Text>
            </View>
            <Text style={s.appName}>Cargo Tracker</Text>
            <Text style={s.tagline}>Fleet Management Platform</Text>
          </View>

          {/* Card */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Welcome back</Text>
            <Text style={s.cardSub}>Sign in to your account</Text>

            <View style={s.field}>
              <Text style={s.label}>Email address</Text>
              <TextInput
                style={[s.input, emailFocused && s.inputFocused]}
                placeholder="you@example.com"
                placeholderTextColor={Colors.textMuted}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!loading}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                returnKeyType="next"
              />
            </View>

            <View style={s.field}>
              <Text style={s.label}>Password</Text>
              <TextInput
                style={[s.input, passFocused && s.inputFocused]}
                placeholder="Enter password"
                placeholderTextColor={Colors.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                editable={!loading}
                onFocus={() => setPassFocused(true)}
                onBlur={() => setPassFocused(false)}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
            </View>

            <TouchableOpacity
              style={[s.btn, loading && s.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.btnText}>Sign In</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={s.linkRow}
              onPress={() => navigation.navigate('Register')}
              activeOpacity={0.7}
            >
              <Text style={s.linkText}>
                Don't have an account?{'  '}
                <Text style={s.linkHighlight}>Create one</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = {
  safe: { flex: 1, backgroundColor: Colors.background } as const,
  scroll: {
    flexGrow: 1,
    justifyContent: 'center' as const,
    paddingHorizontal: Spacing[5],
    paddingVertical: Spacing[8],
  },
  brandContainer: {
    alignItems: 'center' as const,
    marginBottom: Spacing[8],
  },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: Spacing[3],
    ...Shadow.md,
  },
  logoText: {
    color: '#fff',
    fontSize: FontSize['2xl'],
    fontWeight: '800' as const,
    letterSpacing: 1,
  },
  appName: {
    fontSize: FontSize['3xl'],
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: Spacing[1],
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing[6],
    ...Shadow.lg,
  },
  cardTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: Spacing[1],
  },
  cardSub: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing[6],
  },
  field: {
    marginBottom: Spacing[4],
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: Spacing[2],
  },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[4],
    paddingVertical: 14,
    fontSize: FontSize.base,
    color: Colors.text,
  },
  inputFocused: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  btn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center' as const,
    marginTop: Spacing[2],
    ...Shadow.md,
  },
  btnDisabled: {
    backgroundColor: Colors.disabled,
  },
  btnText: {
    color: '#fff',
    fontSize: FontSize.base,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  linkRow: {
    alignItems: 'center' as const,
    marginTop: Spacing[5],
  },
  linkText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  linkHighlight: {
    color: Colors.primary,
    fontWeight: '700' as const,
  },
};
