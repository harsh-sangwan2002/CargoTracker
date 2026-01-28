import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
} from 'react-native';
import StyleSheet from '../utils/styleShim';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../firebaseConfig';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { createUserProfile } from '../services/userService';

export default function RegisterScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const navigation = useNavigation<any>();

    const handleRegister = async () => {
        if (!email || !password || !confirmPassword) {
            Alert.alert('Error', 'Please fill all fields');
            return;
        }
        if (password !== confirmPassword) {
            Alert.alert('Error', 'Passwords do not match');
            return;
        }

        setLoading(true);
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            
            // Create user profile with default 'driver' role
            await createUserProfile(userCredential.user.uid, email, 'driver');
            
            Alert.alert('Success ✓', 'Account created successfully!');
            navigation.replace('Login');
        } catch (err: any) {
            let message = 'Registration failed. Please try again.';
            if (err.code === 'auth/email-already-in-use') {
                message = 'This email is already registered.';
            } else if (err.code === 'auth/invalid-email') {
                message = 'Please enter a valid email address.';
            } else if (err.code === 'auth/weak-password') {
                message = 'Password should be at least 6 characters.';
            }
            Alert.alert('Registration Failed', message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.content}>
                <Text style={styles.title}>Create Account</Text>
                <Text style={styles.subtitle}>Cargo Tracker</Text>

                <View style={styles.form}>
                    <TextInput
                        style={styles.input}
                        placeholder="Email"
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        editable={!loading}
                    />
                    <TextInput
                        style={styles.input}
                        placeholder="Password"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        editable={!loading}
                    />
                    <TextInput
                        style={styles.input}
                        placeholder="Confirm Password"
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        secureTextEntry
                        editable={!loading}
                    />

                    <TouchableOpacity
                        style={[styles.button, loading && styles.buttonDisabled]}
                        onPress={handleRegister}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.buttonText}>Register</Text>
                        )}
                    </TouchableOpacity>

                    {/* Beautiful centered "Login" link */}
                    <TouchableOpacity
                        onPress={() => navigation.navigate('Login')}
                        style={styles.registerLinkContainer}
                    >
                        <Text style={styles.registerLinkText}>
                            Already have an account?{' '}
                            <Text style={styles.registerHighlight}>Login</Text>
                        </Text>
                    </TouchableOpacity>
                </View>

                <Text style={styles.hint}>Powered by Firebase Authentication</Text>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    title: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#1d4ed8',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 40,
    },
    form: {
        width: '100%',
        maxWidth: 400,
    },
    input: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 16,
        fontSize: 16,
        backgroundColor: '#f9fafb',
    },
    button: {
        backgroundColor: '#1d4ed8',
        borderRadius: 8,
        paddingVertical: 14,
        alignItems: 'center' as const,
        marginTop: 8,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    // Centered & styled link (same as Login screen)
    registerLinkContainer: {
        marginTop: 24,
        alignItems: 'center',
    },
    registerLinkText: {
        fontSize: 15,
        color: '#4b5563',
        textAlign: 'center',
    },
    registerHighlight: {
        color: '#1d4ed8',
        fontWeight: '600',
        textDecorationLine: 'underline',
    },

    hint: {
        fontSize: 12,
        color: '#6b7280',
        marginTop: 20,
    },
});