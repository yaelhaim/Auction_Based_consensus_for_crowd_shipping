import React, { useEffect, useCallback } from 'react';
import { Pressable, StyleSheet, StatusBar, ImageBackground } from 'react-native';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync().catch(() => {});

const splashBg = require('../assets/images/SplashScreen.png');

export default function Index() {
  const router = useRouter();
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const handleTap = useCallback(() => {
    router.replace('/home');
  }, [router]);

  return (
    <Pressable style={styles.container} onPress={handleTap}>
      <StatusBar hidden />
      <ImageBackground source={splashBg} style={styles.bg} resizeMode="cover" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  bg: { flex: 1, width: '100%', height: '100%' },
});
