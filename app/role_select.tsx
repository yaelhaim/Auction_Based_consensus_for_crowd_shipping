// app/role_select.tsx
// Role selection → navigates to a dynamic route "/[role]/home_page".
// This avoids TS literal-union issues by using a single literal path with params.

import React, { useEffect, useState, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useLocalSearchParams } from "expo-router";
import AnimatedBgBlobs from "./components/AnimatedBgBlobs";

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

  // Responsive card width
  const { width } = useWindowDimensions();
  const CARD_W = Math.min(width * 0.92, 480);

  useEffect(() => {
    setName(""); // optionally fetch /me for greeting
  }, [token]);

  const goNext = useCallback(
    async (role: RoleKey) => {
      try {
        await AsyncStorage.setItem("role_today", role);
      } catch {}
      // Dynamic path: "/[role]/home_page" + params → role + token
      router.replace({
        pathname: `/${role}_home_page`,
        params: token ? { token: String(token) } : {},
      });
    },
    [router, token]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <AnimatedBgBlobs />
      <View style={styles.center}>
        <View style={[styles.card, { width: CARD_W }]}>
          <Text style={styles.title}>
            {name ? `, ${name}` : ""} בתור מי תרצו להתקדם מכאן ?
          </Text>
          <Text style={styles.subtitle}>
            אפשר לשנות בכל רגע מהפרופיל. הבחירה תתאים את דף הבית והתפריטים.
          </Text>

          <RoleItem
            emoji="📦"
            title="שולח/ת חבילה"
            desc="צרו משלוח חדש, עקבו אחרי משלוחים קיימים"
            accent={COLORS.mocha}
            onPress={() => goNext("sender")}
          />
          <RoleItem
            emoji="🚗"
            title="מחפש/ת טרמפ"
            desc="מצאו טרמפ במסלולים קרובים והצטרפו אליו"
            accent={COLORS.primary}
            onPress={() => goNext("rider")}
          />
          <RoleItem
            emoji="🛵"
            title="שליח/ה"
            desc="קבלו בקשות חדשות, מסלולים מומלצים"
            accent={COLORS.primaryDark}
            onPress={() => goNext("courier")}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function RoleItem({
  emoji,
  title,
  desc,
  accent,
  onPress,
}: {
  emoji: string;
  title: string;
  desc: string;
  accent: string;
  onPress?: () => void;
}) {
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
      <View style={{ flex: 1 }}>
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
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.text,
    textAlign: "center",
    writingDirection: "rtl",
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: COLORS.dim,
    textAlign: "center",
    writingDirection: "rtl",
    marginBottom: 10,
  },
  roleRow: {
    flexDirection: "row-reverse",
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
  },
  roleTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.text,
    writingDirection: "rtl",
  },
  roleDesc: {
    fontSize: 12,
    color: COLORS.dim,
    writingDirection: "rtl",
  },
  hint: { marginTop: 10, textAlign: "center", color: COLORS.dim, fontSize: 12 },
});
