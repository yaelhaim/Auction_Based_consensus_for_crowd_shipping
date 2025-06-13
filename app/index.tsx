import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { JSX } from 'react/jsx-runtime';

export default function HomeScreen(): JSX.Element {
  const router = useRouter();

  return (
    <View style={styles.container}>
      {/* Sign Up Buttons */}
      <TouchableOpacity style={styles.button} onPress={() => router.push('/CourierSignUp')}>
        <Text style={styles.buttonText}>Sign Up as Courier</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={() => router.push('/SenderSignUp')}>
        <Text style={styles.buttonText}>Sign Up as Sender</Text>
      </TouchableOpacity>

      {/* OR Text */}
      <Text style={styles.orText}>or</Text>

      {/* Login Buttons */}
      <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/CourierLogin')}>
        <Text style={styles.secondaryButtonText}>Login as Courier</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/SenderLogin')}>
        <Text style={styles.secondaryButtonText}>Login as Sender</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
  },
  button: {
    backgroundColor: '#24D1C0',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 8,
    marginVertical: 8,
    width: '80%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  orText: {
    fontSize: 16,
    color: '#888',
    marginVertical: 16,
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderColor: '#24D1C0',
    borderWidth: 2,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 8,
    marginVertical: 8,
    width: '80%',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#24D1C0',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
