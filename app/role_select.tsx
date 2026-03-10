// app/role_select.tsx
// Role selection → navigates to "/[role]_home_page".

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  Alert,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useLocalSearchParams } from "expo-router";
import AnimatedBgBlobs from "./components/AnimatedBgBlobs";

import { registerAndSyncPushToken, getPushDebugReport } from "../lib/push";
import { BASE_URL, updateUserRole, type BackendRole } from "../lib/api";

const COLORS = {
  bg: "#ffffff",
  text: "#0b0b0b",
  dim: "#6b7280",
  primary: "#9bac70",
  primaryDark: "#475530",
  mocha: "#8b5e3c",
  border: "#e5e7eb",
  card: "#ffffff",
};

type RoleKey = "sender" | "rider" | "courier";

export default function RoleSelectScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [name, setName] = useState<string>("");

  // למנוע רישום כפול אם המסך נטען שוב
  const didRegisterRef = useRef(false);

  // רוחב כרטיס רספונסיבי
  const { width } = useWindowDimensions();
  const CARD_W = Math.min(width * 0.92, 480);

  useEffect(() => {
    setName(""); // אפשר בעתיד למשוך /me כדי להציג שם
  }, [token]);

  // רישום טוקן לשרת אחרי התחברות (פעם אחת)
  useEffect(() => {
    (async () => {
      if (!token || didRegisterRef.current) return;
      didRegisterRef.current = true;
      try {
        console.log(
          "[PUSH] Post-login: registering Expo token… (platform:",
          Platform.OS,
          ")",
        );
        const synced = await registerAndSyncPushToken(BASE_URL, String(token));
        console.log("[PUSH] registerAndSyncPushToken →", synced ?? "(null)");
        if (!synced) {
          console.log(
            "[PUSH] Registration returned null (no token or server error).",
          );
        }
      } catch (e) {
        console.log("[PUSH] Post-login push registration failed:", e);
      }
    })();
  }, [token]);

  const goNext = useCallback(
    async (role: RoleKey) => {
      // Map UI role -> backend role
      // - courier → driver
      // - sender / rider → sender
      const backendRole: BackendRole = role === "courier" ? "driver" : "sender";

      try {
        await AsyncStorage.setItem("role_today", role);
      } catch {}

      // If we have a token, try to update role in DB (but do not block navigation on failure)
      if (token) {
        try {
          await updateUserRole(String(token), backendRole);
        } catch (e) {
          console.log("[RoleSelect] Failed to update backend role:", e);
        }
      }

      // Navigate to the chosen home page (UI role)
      router.replace({
        pathname: `/${role}_home_page`,
        params: token ? { token: String(token) } : {},
      });
    },
    [router, token],
  );

  // כפתור בדיקה שמציג דו"ח מלא ב-Alert (ללא תלות בלוגים)
  const runPushDebug = useCallback(async () => {
    try {
      const report = await getPushDebugReport();
      Alert.alert("Push Debug", report);
    } catch (e) {
      Alert.alert("Push Debug", String(e));
    }
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <AnimatedBgBlobs />
      <View style={styles.center}>
        <View style={[styles.card, { width: CARD_W }]}>
          <Text style={styles.title}>
            {name ? `, ${name}` : ""} How would you like to continue?
          </Text>
          <Text style={styles.subtitle}>
            You can change this anytime from your profile. Your choice will
            customize the home screen and menus.
          </Text>

          <RoleItem
            emoji="📦"
            title="Send a Package"
            desc="Create a new delivery and track existing shipments"
            accent={COLORS.mocha}
            onPress={() => goNext("sender")}
          />
          <RoleItem
            emoji="🚗"
            title="Find a Ride"
            desc="Discover nearby rides and join a route that fits you"
            accent={COLORS.primary}
            onPress={() => goNext("rider")}
          />
          <RoleItem
            emoji="🛵"
            title="Courier"
            desc="Receive new requests and view recommended routes"
            accent={COLORS.primaryDark}
            onPress={() => goNext("courier")}
          />

          {/* כפתור בדיקת פוש – מציג דו״ח מלא */}
          <TouchableOpacity
            onPress={runPushDebug}
            style={{
              marginTop: 12,
              alignSelf: "center",
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderWidth: 1,
              borderRadius: 10,
              borderColor: COLORS.border,
            }}
          >
            <Text style={{ color: COLORS.text }}>Push Test (Show Report)</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function RoleItem({ emoji, title, desc, accent, onPress }: any) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.roleRow, { borderColor: accent }]}
      activeOpacity={0.9}
    >
      <View
        style={[
          styles.roleEmoji,
          { backgroundColor: accent + "22", borderColor: accent },
        ]}
      >
        <Text style={{ fontSize: 22 }}>{emoji}</Text>
      </View>

      {/* ✅ Text column */}
      <View style={styles.roleTextCol}>
        <Text style={styles.roleTitle}>{title}</Text>
        <Text style={styles.roleDesc}>{desc}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    shadowColor: "#000000ff",
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.text,
    textAlign: "left",
    writingDirection: "ltr",
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: COLORS.dim,
    textAlign: "left",
    writingDirection: "ltr",
    marginBottom: 10,
  },
  roleRow: {
    direction: "ltr",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 2,
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    backgroundColor: "#fff",
  },
  roleEmoji: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    marginRight: 12,
  },
  roleTextCol: {
    flex: 1,
    alignItems: "flex-start",
  },
  roleTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.text,
    writingDirection: "ltr",
    textAlign: "left",
  },
  roleDesc: {
    fontSize: 12,
    color: COLORS.dim,
    writingDirection: "ltr",
    textAlign: "left",
  },
});
