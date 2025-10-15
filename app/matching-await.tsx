// app/matching-await.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import AnimatedBgBlobs from "./components/AnimatedBgBlobs";
import { deferPushForRequest, checkMatchStatus } from "../lib/api";

const POLL_MS = 1500;
const DEFER_SECONDS = 120;
const DEFAULT_WAIT_MS = 60000;
const GRACE_MS = 30000;

export default function MatchingAwait() {
  const router = useRouter();
  const { requestId, token, role, home } = useLocalSearchParams<{
    requestId: string;
    token?: string;
    role?: "rider" | "sender";
    home?: string;
  }>();

  const [status, setStatus] = useState<"searching" | "matched" | "timeout">(
    "searching"
  );
  const [assignmentId, setAssignmentId] = useState<string | null>(null);

  const deadlineRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertedRef = useRef(false);

  const homePath =
    home ||
    (role === "sender"
      ? "/sender_home_page"
      : role === "rider"
        ? "/rider_home_page"
        : "/home_page");

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (deadlineRef.current === null) {
        deadlineRef.current = Date.now() + DEFAULT_WAIT_MS + GRACE_MS;
      }

      // דוחה פושים בצד השרת – לא קריטי להצגה, אבל שומר התנהגות רצויה
      try {
        const resp = await deferPushForRequest(
          String(token || ""),
          String(requestId),
          DEFER_SECONDS
        );
        const untilIso = (resp as any)?.push_defer_until;
        if (untilIso) {
          const ts = Date.parse(untilIso);
          if (!Number.isNaN(ts)) deadlineRef.current = ts + GRACE_MS;
        }
      } catch {}

      async function poll() {
        try {
          // ❗️ זה ה-API החדש שמחזיר בדיוק האם ה-IDA* שיבץ
          const res = await checkMatchStatus(
            String(token || ""),
            String(requestId)
          );
          if (cancelled) return;

          if (res?.status === "matched" && res.assignment_id) {
            setAssignmentId(String(res.assignment_id));
            setStatus("matched");
            return;
          }
        } catch {}

        const stopAt =
          deadlineRef.current ?? Date.now() + DEFAULT_WAIT_MS + GRACE_MS;
        if (Date.now() >= stopAt) {
          setStatus("timeout");
          return;
        }
        timerRef.current = setTimeout(poll, POLL_MS);
      }

      poll();
    }

    start();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [requestId, token]);

  useEffect(() => {
    if (status === "timeout" && !alertedRef.current) {
      alertedRef.current = true;
      Alert.alert("אין התאמה כרגע", "נשלח לך התראה כשיימצא נהג/שליח מתאים.");
    }
  }, [status]);

  function goHome() {
    router.replace({ pathname: homePath as any, params: { token } });
  }
  function openAssignment() {
    // אם יש לכם מסך שיבוץ ייעודי – לנווט אליו; כרגע חוזרים לבית
    goHome();
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <AnimatedBgBlobs />
      <View style={S.box}>
        {status === "searching" && (
          <>
            <ActivityIndicator size="large" />
            <Text style={S.title}>מחפשים לך התאמה…</Text>
            <Text style={S.sub}>נציג כאן ברגע שהמערכת מצאה שיבוץ.</Text>
            <TouchableOpacity style={S.linkBtn} onPress={goHome}>
              <Text style={S.linkText}>חזרה לדף הבית</Text>
            </TouchableOpacity>
          </>
        )}

        {status === "matched" && (
          <>
            <Text style={S.title}>🎉 נמצאה התאמה!</Text>
            <Text style={S.sub}>אפשר להמשיך לפרטים.</Text>
            <TouchableOpacity style={S.cta} onPress={openAssignment}>
              <Text style={S.ctaText}>פתח/י את ההתאמה</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.linkBtn} onPress={goHome}>
              <Text style={S.linkText}>דף הבית</Text>
            </TouchableOpacity>
          </>
        )}

        {status === "timeout" && (
          <>
            <Text style={S.title}>אין התאמה כרגע</Text>
            <Text style={S.sub}>נשלח לך התראה אם תימצא התאמה מאוחר יותר.</Text>
            <TouchableOpacity style={S.cta} onPress={goHome}>
              <Text style={S.ctaText}>בסדר, חזרה לדף הבית</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  box: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 10,
  },
  sub: { fontSize: 14, opacity: 0.7, textAlign: "center" },
  cta: {
    backgroundColor: "#9bac70",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginTop: 6,
  },
  ctaText: { color: "#fff", fontWeight: "800" },
  linkBtn: { padding: 10, marginTop: 8 },
  linkText: { color: "#475569", fontWeight: "600" },
});
