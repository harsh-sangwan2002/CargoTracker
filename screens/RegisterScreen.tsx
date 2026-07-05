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
import { createUserWithEmailAndPassword } from '../supabaseConfig';
import { createUserProfile } from '../services/userService';
import { addDriver } from '../services/driverService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const navigation = useNavigation<any>();

  const handleRegister = async () => {
    if (!email.trim() || !password || !confirmPassword) {
      Alert.alert('Required', 'Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(email.trim(), password);
      if (!cred.user?.id) throw new Error('Account created but user session was not returned.');
      try {
        await createUserProfile(cred.user.id, email.trim(), 'driver');
      } catch {
        // The database trigger on auth.users is the source of truth; this client write is only a fallback.
      }
      // Create a minimal driver record so managers see this user immediately in the driver list.
      // If the manager already added a driver with this email, this merges into that existing record.
      try {
        await addDriver({
          fullName: '',
          age: 0,
          address: '',
          aadhaarCard: '',
          panCard: '',
          vehicleOwned: '',
          photoUrl: '',
          userId: cred.user.id,
          email: email.trim().toLowerCase(),
        });
      } catch {
        // Non-critical — driver can complete their profile to appear in the list.
      }
      Alert.alert('Account created', 'You have been registered as a driver. An admin can update your role if needed.');
    } catch (err: any) {
      const map: Record<string, string> = {
        'user_already_exists': 'This email is already registered.',
        'email_address_invalid': 'Please enter a valid email address.',
        'weak_password': 'Password must be at least 6 characters.',
        'over_email_send_rate_limit': 'Supabase email limit reached. Disable email confirmation for development or configure custom SMTP in Supabase Auth settings.',
      };
      const message = String(err.message ?? '').toLowerCase();
      const friendly =
        map[err.code] ??
        (message.includes('email') && message.includes('rate limit')
          ? 'Supabase email limit reached. Disable email confirmation for development or configure custom SMTP in Supabase Auth settings.'
          : err.message);
      Alert.alert('Registration Failed', friendly ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = (name: string) => [
    s.input,
    focused === name && s.inputFocused,
  ];

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
          <View style={s.brandContainer}>
            <View style={s.logoBox}>
              <Text style={s.logoText}>CT</Text>
            </View>
            <Text style={s.appName}>CargoTracker</Text>
            <Text style={s.tagline}>Create your account</Text>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Get started</Text>
            <Text style={s.cardSub}>New accounts are assigned the Driver role by default.</Text>

            <View style={s.field}>
              <Text style={s.label}>Email address</Text>
              <TextInput
                style={inputStyle('email')}
                placeholder="you@example.com"
                placeholderTextColor={Colors.textMuted}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!loading}
                onFocus={() => setFocused('email')}
                onBlur={() => setFocused(null)}
                returnKeyType="next"
              />
            </View>

            <View style={s.field}>
              <Text style={s.label}>Password</Text>
              <TextInput
                style={inputStyle('pass')}
                placeholder="Min 6 characters"
                placeholderTextColor={Colors.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                editable={!loading}
                onFocus={() => setFocused('pass')}
                onBlur={() => setFocused(null)}
                returnKeyType="next"
              />
            </View>

            <View style={s.field}>
              <Text style={s.label}>Confirm password</Text>
              <TextInput
                style={inputStyle('confirm')}
                placeholder="Re-enter password"
                placeholderTextColor={Colors.textMuted}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                editable={!loading}
                onFocus={() => setFocused('confirm')}
                onBlur={() => setFocused(null)}
                returnKeyType="done"
                onSubmitEditing={handleRegister}
              />
            </View>

            <TouchableOpacity
              style={[s.btn, loading && s.btnDisabled]}
              onPress={handleRegister}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.btnText}>Create Account</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={s.linkRow}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
            >
              <Text style={s.linkText}>
                Already have an account?{'  '}
                <Text style={s.linkHighlight}>Sign in</Text>
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
    lineHeight: 20,
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
    letterSpacing: 0,
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
