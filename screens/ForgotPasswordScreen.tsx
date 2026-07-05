import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { sendOtp, resetPasswordWithOtp, signOut } from '../supabaseConfig';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import { isValidOtp } from '../utils/otpUtils';

type Step = 'email' | 'otp' | 'password';

export default function ForgotPasswordScreen() {
  const navigation = useNavigation<any>();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    if (!email.trim()) { Alert.alert('Required', 'Please enter your email address.'); return; }
    setLoading(true);
    try {
      await sendOtp(email.trim().toLowerCase());
      setStep('otp');
    } catch (err: any) {
      const msg: string = err.message ?? '';
      if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('no account')) {
        Alert.alert('Not Found', 'No account found with this email address.');
      } else {
        Alert.alert('Error', msg || 'Failed to send OTP. Check your email and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOtpNext = () => {
    if (!isValidOtp(otp.trim())) {
      Alert.alert('Required', 'Please enter the 6-digit code from your email.');
      return;
    }
    setStep('password');
  };

  const handleResetPassword = async () => {
    if (newPassword.length < 6) { Alert.alert('Weak Password', 'Password must be at least 6 characters.'); return; }
    if (newPassword !== confirmPassword) { Alert.alert('Mismatch', 'Passwords do not match.'); return; }
    setLoading(true);
    try {
      await resetPasswordWithOtp(email.trim().toLowerCase(), otp.trim(), newPassword);
      await signOut();
      Alert.alert(
        'Password Updated',
        'Your password has been changed. Please sign in with your new password.',
        [{ text: 'OK', onPress: () => navigation.navigate('Login') }],
      );
    } catch (err: any) {
      const msg: string = err.message ?? '';
      if (msg.toLowerCase().includes('incorrect') || msg.toLowerCase().includes('otp')) {
        Alert.alert('Invalid Code', msg || 'The OTP is incorrect or has expired. Please go back and request a new one.');
      } else {
        Alert.alert('Error', msg || 'Failed to reset password. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const stepActions: Record<Step, { title: string; sub: string; btnLabel: string; onPress: () => void }> = {
    email: {
      title: 'Forgot Password',
      sub: "Enter your registered email. We'll send you a 6-digit reset code.",
      btnLabel: 'Send Code',
      onPress: handleSendOtp,
    },
    otp: {
      title: 'Enter Code',
      sub: `A 6-digit code was sent to ${email}. Check your inbox (and spam folder).`,
      btnLabel: 'Next',
      onPress: handleOtpNext,
    },
    password: {
      title: 'New Password',
      sub: 'Choose a strong password. The code will be verified when you tap Update.',
      btnLabel: 'Update Password',
      onPress: handleResetPassword,
    },
  };

  const { title, sub, btnLabel, onPress } = stepActions[step];
  const steps: Step[] = ['email', 'otp', 'password'];
  const currentIndex = steps.indexOf(step);

  const goBack = () => {
    if (step === 'email') navigation.goBack();
    else if (step === 'otp') { setOtp(''); setStep('email'); }
    else setStep('otp');
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Step indicator */}
          <View style={s.steps}>
            {steps.map((st, i) => {
              const isDone = i < currentIndex;
              const isActive = st === step;
              return (
                <View key={st} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[s.stepDot, isActive && s.stepDotActive, isDone && s.stepDotDone]}>
                    <Text style={[s.stepNum, (isActive || isDone) && s.stepNumActive]}>{i + 1}</Text>
                  </View>
                  {i < 2 && <View style={[s.stepLine, i < currentIndex && s.stepLineDone]} />}
                </View>
              );
            })}
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>{title}</Text>
            <Text style={s.cardSub}>{sub}</Text>

            {step === 'email' && (
              <View style={s.field}>
                <Text style={s.label}>Email address</Text>
                <TextInput
                  style={s.input}
                  placeholder="you@example.com"
                  placeholderTextColor={Colors.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={!loading}
                  returnKeyType="done"
                  onSubmitEditing={handleSendOtp}
                />
              </View>
            )}

            {step === 'otp' && (
              <View style={s.field}>
                <Text style={s.label}>6-digit code</Text>
                <TextInput
                  style={[s.input, s.otpInput]}
                  placeholder="000000"
                  placeholderTextColor={Colors.textMuted}
                  value={otp}
                  onChangeText={t => setOtp(t.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  editable={!loading}
                  returnKeyType="done"
                  onSubmitEditing={handleOtpNext}
                  maxLength={6}
                />
                <TouchableOpacity
                  onPress={() => { setOtp(''); handleSendOtp(); }}
                  style={s.resendBtn}
                  disabled={loading}
                >
                  <Text style={s.resendText}>Resend code</Text>
                </TouchableOpacity>
              </View>
            )}

            {step === 'password' && (
              <>
                <View style={s.field}>
                  <Text style={s.label}>New Password</Text>
                  <TextInput
                    style={s.input}
                    placeholder="Min 6 characters"
                    placeholderTextColor={Colors.textMuted}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry
                    editable={!loading}
                    returnKeyType="next"
                  />
                </View>
                <View style={s.field}>
                  <Text style={s.label}>Confirm Password</Text>
                  <TextInput
                    style={s.input}
                    placeholder="Re-enter password"
                    placeholderTextColor={Colors.textMuted}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                    editable={!loading}
                    returnKeyType="done"
                    onSubmitEditing={handleResetPassword}
                  />
                </View>
              </>
            )}

            <TouchableOpacity
              style={[s.btn, loading && s.btnDisabled]}
              onPress={onPress}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{btnLabel}</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={s.backBtn} onPress={goBack} disabled={loading} activeOpacity={0.7}>
              <Text style={s.backText}>← {step === 'email' ? 'Back to Sign In' : 'Go Back'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = {
  safe: { flex: 1, backgroundColor: Colors.background } as const,
  scroll: { flexGrow: 1, justifyContent: 'center' as const, paddingHorizontal: Spacing[5], paddingVertical: Spacing[8] },

  steps: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: Spacing[8] },
  stepDot: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 2, borderColor: Colors.border,
    justifyContent: 'center' as const, alignItems: 'center' as const,
  },
  stepDotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  stepDotDone: { backgroundColor: Colors.success, borderColor: Colors.success },
  stepNum: { fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.textMuted },
  stepNumActive: { color: '#fff' },
  stepLine: { width: 40, height: 2, backgroundColor: Colors.border, marginHorizontal: Spacing[1] },
  stepLineDone: { backgroundColor: Colors.success },

  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing[6], ...Shadow.lg },
  cardTitle: { fontSize: FontSize.xl, fontWeight: '700' as const, color: Colors.text, marginBottom: Spacing[1] },
  cardSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing[6], lineHeight: 20 },

  field: { marginBottom: Spacing[4] },
  label: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: Spacing[2] },
  input: {
    backgroundColor: Colors.surfaceAlt, borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: Spacing[4], paddingVertical: 14,
    fontSize: FontSize.base, color: Colors.text,
  },
  otpInput: { fontSize: FontSize['2xl'], fontWeight: '700' as const, letterSpacing: 8, textAlign: 'center' as const },

  resendBtn: { marginTop: Spacing[2], alignSelf: 'flex-end' as const },
  resendText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' as const },

  btn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 16, alignItems: 'center' as const,
    marginTop: Spacing[2], ...Shadow.md,
  },
  btnDisabled: { backgroundColor: Colors.disabled },
  btnText: { color: '#fff', fontSize: FontSize.base, fontWeight: '700' as const, letterSpacing: 0.3 },

  backBtn: { alignItems: 'center' as const, marginTop: Spacing[5] },
  backText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' as const },
};
