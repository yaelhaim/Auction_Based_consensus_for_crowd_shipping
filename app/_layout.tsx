// app/_layout.tsx
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { ensurePushSetup } from "../lib/push";

export default function Layout() {
  // פעם אחת באתחול — הרשאות + Android channel
  useEffect(() => {
    ensurePushSetup();
  }, []);

  return (
    <Stack screenOptions={{ headerTitleAlign: "center" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="home" options={{ headerShown: false }} />
      <Stack.Screen name="wallet-login" options={{ title: "wallet-login" }} />
      <Stack.Screen name="profile-setup" options={{ title: "פרטים אישיים" }} />
      <Stack.Screen name="role_select" options={{ title: "בחירת תפקיד" }} />
    </Stack>
  );
}
