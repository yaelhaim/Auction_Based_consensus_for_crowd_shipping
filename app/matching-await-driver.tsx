// app/matching-await-driver.tsx
// Driver/Courier waiting screen.
// בודק סטטוס התאמה דרך /offers/{id}/match_status,
// ובנוסף נעזר ב-listMyCourierOffers(status='assigned') כדי לאתר אם ההצעה הספציפית כבר הוקצתה.
// דוחה פושים ל-120ש' ושם דדליין (דקה + 30ש' גרייס כברירת מחדל, או לפי push_defer_until מהשרת).

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import AnimatedBgBlobs from "./components/AnimatedBgBlobs";
import {
  deferPushForOffer,
  checkOfferMatchStatus,
  listMyCourierOffers,
  type CourierOfferRow,
} from "../lib/api";

// ⏱ כאן משנים את זמני ההמתנה
const POLL_MS = 1500; // מרווח בין פולינגים (ms)
const DEFER_SECONDS = 120; // דחיית פושים בשרת לשניות
const DEFAULT_WAIT_MS = 60000; // דקה ברירת מחדל אם השרת לא מחזיר push_defer_until
const GRACE_MS = 30000; // גרייס 30ש'

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

  // יעד דף הבית (אפשר להעביר ב-route פרמטר home אם צריך להתאים)
  const homePath = home || "/courier_home_page";

  useEffect(() => {
    let cancelled = false;

    async function start() {
      // קובע דדליין ראשוני
      if (deadlineRef.current === null) {
        deadlineRef.current = Date.now() + DEFAULT_WAIT_MS + GRACE_MS;
      }

      // דוחה פושים בשרת, ואם קיבלנו push_defer_until נעדכן דדליין לפיו
      try {
        const resp = await deferPushForOffer(
          String(token || ""),
          String(offerId),
          DEFER_SECONDS
        );
        const untilIso = (resp as any)?.push_defer_until;
        if (untilIso) {
          const ts = Date.parse(untilIso);
          if (!Number.isNaN(ts)) deadlineRef.current = ts + GRACE_MS;
        }
      } catch {}

      async function poll() {
        // 1) בדיקה ייעודית של מצב ההתאמה
        try {
          const raw = await checkOfferMatchStatus(
            String(token || ""),
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
        } catch {}

        // 2) פולבק פרונטלי: האם ההצעה הזו כבר 'assigned' ברשימת ההצעות שלי?
        try {
          const assigned: CourierOfferRow[] = await listMyCourierOffers(
            String(token || ""),
            { status: "assigned", limit: 50 }
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
        } catch {}

        // 3) טיימאאוט
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
    // אם יש מסך משימה לנהג – לנווט אליו; כרגע חוזרים לבית
    goHome();
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <AnimatedBgBlobs />
      <View style={S.box}>
        {status === "searching" && (
          <>
            <ActivityIndicator size="large" />
            <Text style={S.title}>מחפשים לך משלוח מתאים…</Text>
            <Text style={S.sub}>נציג כאן מיד כשיימצא שיבוץ.</Text>
            <TouchableOpacity style={S.linkBtn} onPress={goHome}>
              <Text style={S.linkText}>חזרה לדף הבית</Text>
            </TouchableOpacity>
          </>
        )}

        {status === "matched" && (
          <>
            <Text style={S.title}>🎉 נמצאה משימה!</Text>
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
            <Text style={S.title}>אין התאמה כרגע</Text>
            <Text style={S.sub}>נשלח לך התראה כשיימצא משלוח מתאים.</Text>
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
