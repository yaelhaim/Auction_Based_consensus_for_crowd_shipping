// app/matching-await-driver.tsx
// Driver waiting screen with city-map background + white card + hourglass.
// משתמש ב-listMyCourierOffers כדי לגלות 'assigned' כהצלבה.

import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  deferPushForOffer,
  checkOfferMatchStatus,
  listMyCourierOffers,
  clearAuctions,
  type CourierOfferRow, // ← חשוב: טיפוס לתוצאת הרשימה
} from "../lib/api";
import WaitBackground from "./components/WaitBackground";
import Hourglass from "./components/Hourglass";

const POLL_MS = 1500;
const DEFER_SECONDS = 120;
const DEFAULT_WAIT_MS = 60000;
const GRACE_MS = 30000;
const cityMap = require("../assets/images/city_map_photo.jpg");

export default function MatchingAwaitDriver() {
  const router = useRouter();
  const { offerId, token, home } = useLocalSearchParams<{
    offerId: string;
    token?: string;
    home?: string;
  }>();

  const [status, setStatus] = useState<"searching" | "matched" | "timeout">(
    "searching"
  );
  const [requestId, setRequestId] = useState<string | null>(null);

  const deadlineRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const homePath = home || "/courier_home_page";

  useEffect(() => {
    let cancelled = false;
    if (!offerId || !token) return;

    async function start() {
      if (deadlineRef.current === null) {
        deadlineRef.current = Date.now() + DEFAULT_WAIT_MS + GRACE_MS;
      }

      // דחיית פושים למסך זה
      try {
        const resp = await deferPushForOffer(
          String(token),
          String(offerId),
          DEFER_SECONDS
        );
        const untilIso = (resp as any)?.push_defer_until;
        if (untilIso) {
          const ts = Date.parse(untilIso);
          if (!Number.isNaN(ts)) deadlineRef.current = ts + GRACE_MS;
        }
      } catch (e) {
        console.log(
          "[await-driver] deferPushForOffer error:",
          (e as any)?.message || e
        );
      }

      // בעיטה חד־פעמית לניקוי (IDA*) – רץ ברקע, לא חוסם UI
      clearAuctions({ now_ts: Math.floor(Date.now() / 1000) })
        .then((r) =>
          console.log(
            "[await-driver] clearAuctions →",
            r?.cleared,
            r?.reason || "",
            r?.debug_counts || {}
          )
        )
        .catch((e) =>
          console.log(
            "[await-driver] clearAuctions error:",
            (e as any)?.message || e
          )
        );

      async function poll() {
        // בדיקה ייעודית לסטטוס ההצעה
        try {
          const raw = await checkOfferMatchStatus(
            String(token),
            String(offerId)
          );
          if (cancelled) return;
          const st = raw?.status;
          const reqId = String(raw?.request_id ?? raw?.requestId ?? "");
          if (st === "matched") {
            if (reqId) setRequestId(reqId);
            setStatus("matched");
            return;
          }
        } catch (e) {
          console.log(
            "[await-driver] checkOfferMatchStatus error:",
            (e as any)?.message || e
          );
        }

        // פולבק: האם ההצעה הזו כבר assigned?
        try {
          const assigned: CourierOfferRow[] = await listMyCourierOffers(
            String(token),
            {
              status: "assigned",
              limit: 50,
            }
          );
          if (!cancelled && Array.isArray(assigned) && assigned.length > 0) {
            const found = assigned.find(
              (o) => String(o.id) === String(offerId)
            );
            if (found) {
              setStatus("matched");
              return;
            }
          }
        } catch (e) {
          console.log(
            "[await-driver] listMyCourierOffers error:",
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
  }, [offerId, token]);

  function goHome() {
    router.replace({ pathname: homePath as any, params: { token } });
  }
  function openAssignment() {
    // אם יש מסך משימה – לנווט אליו; כרגע חוזרים לבית
    goHome();
  }

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
            <Text style={S.title}>מחפשים לך משלוח מתאים…</Text>
            <Text style={S.sub}>זה עשוי לקחת מספר רגעים.</Text>
            <TouchableOpacity style={S.linkBtn} onPress={goHome}>
              <Text style={S.linkText}>חזרה לדף הבית</Text>
            </TouchableOpacity>
          </>
        )}

        {status === "matched" && (
          <>
            <Text style={S.bigEmoji}>🎉</Text>
            <Text style={S.title}>נמצאה משימה!</Text>
            <Text style={S.sub}>אפשר להמשיך לפרטים.</Text>
            <TouchableOpacity style={S.cta} onPress={openAssignment}>
              <Text style={S.ctaText}>פתח/י את המשימה</Text>
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
            <Text style={S.sub}>נשלח לך התראה כשיימצא משלוח מתאים.</Text>
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
