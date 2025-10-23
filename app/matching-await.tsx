// app/matching-await.tsx
// Waiting screen (sender/rider) with city-map background + white card + hourglass.
// Defers pushes, kicks the clearing (IDA*), polls for a match, and routes to the details screen when matched.

import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  deferPushForRequest,
  checkMatchStatus,
  clearAuctions,
} from "../lib/api";
import WaitBackground from "./components/WaitBackground";
import Hourglass from "./components/Hourglass";

const POLL_MS = 1500;
const DEFER_SECONDS = 120;
const DEFAULT_WAIT_MS = 60000;
const GRACE_MS = 30000;
const cityMap = require("../assets/images/city_map_photo.jpg");

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
    if (!requestId || !token) return;

    async function start() {
      // Set a soft deadline for polling
      if (deadlineRef.current === null) {
        deadlineRef.current = Date.now() + DEFAULT_WAIT_MS + GRACE_MS;
      }

      // Defer push notifications for this specific request
      try {
        const resp = await deferPushForRequest(
          String(token),
          String(requestId),
          DEFER_SECONDS
        );
        const untilIso = (resp as any)?.push_defer_until;
        if (untilIso) {
          const ts = Date.parse(untilIso);
          if (!Number.isNaN(ts)) deadlineRef.current = ts + GRACE_MS;
        }
      } catch (e) {
        console.log(
          "[await] deferPushForRequest error:",
          (e as any)?.message || e
        );
      }

      // Fire a non-blocking clearing tick (IDA*)
      clearAuctions({ now_ts: Math.floor(Date.now() / 1000) })
        .then((r: any) =>
          console.log(
            "[await] clearAuctions →",
            r?.cleared,
            r?.reason || "",
            r?.debug_counts || {}
          )
        )
        .catch((e: any) =>
          console.log("[await] clearAuctions error:", e?.message || e)
        );

      // Start polling for a match
      async function poll() {
        try {
          const res = await checkMatchStatus(String(token), String(requestId));
          if (cancelled) return;
          if (res?.status === "matched" && res.assignment_id) {
            setAssignmentId(String(res.assignment_id));
            setStatus("matched");
            return;
          }
        } catch (e) {
          console.log(
            "[await] checkMatchStatus error:",
            (e as any)?.message || e
          );
        }

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

  // Navigate to the assignment details screen we created (app/assignment_details.tsx)
  function openAssignment() {
    router.replace({
      pathname: "/assignment_details",
      params: {
        requestId: String(requestId),
        token: String(token ?? ""),
        role: String(role ?? ""),
        assignmentId: String(assignmentId ?? ""),
      },
    });
  }

  const ctaDisabled = !requestId; // practically always true-but-safe guard

  return (
    <WaitBackground
      imageUri={cityMap}
      opacity={0.7}
      blurRadius={2}
      darken={0.2}
      tintAlpha={0}
    >
      <View style={S.card}>
        {status === "searching" && (
          <>
            <Hourglass />
            <Text style={S.title}>שימי/שימו לב, מחפשים התאמה…</Text>
            <Text style={S.sub}>זה עשוי לקחת מספר רגעים.</Text>
            <TouchableOpacity style={S.linkBtn} onPress={goHome}>
              <Text style={S.linkText}>חזרה לדף הבית</Text>
            </TouchableOpacity>
          </>
        )}

        {status === "matched" && (
          <>
            <Text style={S.bigEmoji}>🎉</Text>
            <Text style={S.title}>נמצאה התאמה!</Text>
            <Text style={S.sub}>אפשר להמשיך לפרטים.</Text>
            <TouchableOpacity
              style={[S.cta, ctaDisabled && { opacity: 0.6 }]}
              onPress={openAssignment}
              disabled={ctaDisabled}
            >
              <Text style={S.ctaText}>פתח/י את ההתאמה</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.linkBtn} onPress={goHome}>
              <Text style={S.linkText}>דף הבית</Text>
            </TouchableOpacity>
          </>
        )}

        {status === "timeout" && (
          <>
            <Text style={S.bigEmoji}>⌚</Text>
            <Text style={S.title}>אין התאמה כרגע</Text>
            <Text style={S.sub}>נשלח לך התראה אם תימצא התאמה מאוחר יותר.</Text>
            <TouchableOpacity style={S.cta} onPress={goHome}>
              <Text style={S.ctaText}>חזרה לדף הבית</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </WaitBackground>
  );
}

const S = StyleSheet.create({
  card: {
    width: "92%",
    maxWidth: 520,
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 18,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    gap: 10,
  },
  bigEmoji: { fontSize: 48, marginBottom: 4 },
  title: {
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
    color: "#1f2937",
    marginTop: 4,
  },
  sub: { fontSize: 14, opacity: 0.7, textAlign: "center", color: "#334155" },
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
