import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import { Stack } from "expo-router";
import React from "react";

export default function Layout() {
  return (
    <Stack screenOptions={{ headerTitleAlign: "center" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="home" options={{ headerShown: false }} />
      <Stack.Screen name="wallet-login" options={{ title: "wallet-login" }} />
      <Stack.Screen name="profile-setup" options={{ title: "פרטים אישיים" }} />
    </Stack>
  );
}
