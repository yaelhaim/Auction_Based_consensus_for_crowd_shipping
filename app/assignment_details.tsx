// app/assignment_details.tsx
// Unified assignment screen for sender/rider/driver.
// UI texts in Hebrew, comments in English.

import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  listSenderRequests,
  listRiderRequests,
  listMyCourierOffers,
  checkOfferMatchStatus,
  // optional if you have:
  // getRequestById,
  type RequestRow,
  type RiderRequestRow,
  type CourierOfferRow,
} from "../lib/api";

type Role = "sender" | "rider" | "driver";

export default function AssignmentDetails() {
  const router = useRouter();
  const { role, token, requestId, offerId, home } = useLocalSearchParams<{
    role: Role;
    token: string;
    requestId?: string;
    offerId?: string;
    home?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A minimal view-model that the UI can render for all roles
  type VM = {
    requestId: string;
    from_address?: string | null;
    to_address?: string | null;
    window_start?: string | null;
    window_end?: string | null;
    price_hint?: number | null;
    status?: string;
  };
  const [vm, setVM] = useState<VM | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      // Abort previous load if any
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();

      try {
        if (!token) {
          throw new Error("missing token");
        }
        const r: Role = (role as Role) || "sender";

        if (r === "sender") {
          // Sender path: search the request in active→open buckets
          const buckets: ("active" | "open")[] = ["active", "open"];
          let found: RequestRow | null = null;
          for (const b of buckets) {
            const rows = await listSenderRequests(String(token), b, {
              limit: 50,
            });
            found =
              rows.find((x) => String(x.id) === String(requestId)) || null;
            if (found) break;
          }
          if (!found) throw new Error("לא נמצאה בקשה להצגה");

          setVM({
            requestId: String(found.id),
            from_address: found.from_address ?? null,
            to_address: found.to_address ?? null,
            window_start: found.window_start ?? null,
            window_end: found.window_end ?? null,
            price_hint: (found as any).max_price ?? null,
            status: found.status,
          });
        } else if (r === "rider") {
          // Rider path: search via rider endpoints (passenger/ride types)
          const buckets: ("active" | "open")[] = ["active", "open"];
          let found: RiderRequestRow | null = null;
          for (const b of buckets) {
            const rows = await listRiderRequests(String(token), b, {
              limit: 50,
            });
            found =
              rows.find((x) => String(x.id) === String(requestId)) || null;
            if (found) break;
          }
          if (!found) throw new Error("לא נמצאה בקשה להצגה");

          setVM({
            requestId: String(found.id),
            from_address: found.from_address ?? null,
            to_address: found.to_address ?? null,
            window_start: found.window_start ?? null,
            window_end: found.window_end ?? null,
            price_hint: (found as any).max_price ?? null,
            status: found.status,
          });
        } else {
          // Driver path: start from offerId → discover matched requestId
          if (!offerId && !requestId) {
            throw new Error("חסר מזהה הצעה או בקשה");
          }

          let reqId = String(requestId || "");

          // 1) Try a direct status check on the offer
          if (offerId) {
            try {
              const st = await checkOfferMatchStatus(
                String(token),
                String(offerId)
              );
              if (st?.status === "matched" && (st.request_id || st.requestId)) {
                reqId = String(st.request_id || st.requestId);
              }
            } catch (e) {
              // swallow, we'll try the fallback
            }
          }

          // 2) Fallback: find the offer in assigned list
          if (!reqId && offerId) {
            const assigned: CourierOfferRow[] = await listMyCourierOffers(
              String(token),
              {
                status: "assigned",
                limit: 50,
              }
            );
            const mine = assigned.find((o) => String(o.id) === String(offerId));
            // if the API returns the matched request_id on the row, grab it
            if ((mine as any)?.request_id) {
              reqId = String((mine as any).request_id);
            }
          }

          if (!reqId) {
            throw new Error("לא נמצאה התאמה להצעה זו עדיין");
          }

          // 3) Build a minimal VM to render. If you have getRequestById, use it:
          // const req = await getRequestById(String(token), reqId);
          // For now, just show the ID (and let the UI reflect “matched” state)
          setVM({
            requestId: reqId,
            from_address: null,
            to_address: null,
            window_start: null,
            window_end: null,
            price_hint: null,
            status: "assigned",
          });
        }

        if (!cancelled) setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "שגיאה בטעינת הנתונים");
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      if (abortRef.current) abortRef.current.abort();
    };
  }, [role, token, requestId, offerId]);

  function goHome() {
    router.replace({
      pathname: (home as any) || "/home_page",
      params: { token },
    });
  }

  if (loading) {
    return (
      <View style={S.wrap}>
        <ActivityIndicator />
        <Text style={S.sub}>טוען נתונים…</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={S.wrap}>
        <Text style={S.err}>{error}</Text>
        <TouchableOpacity onPress={goHome} style={S.btn}>
          <Text style={S.btnText}>חזרה</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!vm) return null;

  return (
    <View style={S.container}>
      <Text style={S.title}>התאמה שנמצאה</Text>
      <Text style={S.row}>מזהה בקשה: {vm.requestId}</Text>
      {vm.from_address ? (
        <Text style={S.row}>מוצא: {vm.from_address}</Text>
      ) : null}
      {vm.to_address ? <Text style={S.row}>יעד: {vm.to_address}</Text> : null}
      {vm.window_start ? (
        <Text style={S.row}>חלון התחלה: {vm.window_start}</Text>
      ) : null}
      {vm.window_end ? (
        <Text style={S.row}>חלון סיום: {vm.window_end}</Text>
      ) : null}
      {vm.price_hint != null ? (
        <Text style={S.row}>תקציב: ₪{vm.price_hint}</Text>
      ) : null}

      <TouchableOpacity onPress={goHome} style={[S.btn, { marginTop: 16 }]}>
        <Text style={S.btnText}>חזרה</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  container: { flex: 1, padding: 16, gap: 10 },
  title: { fontSize: 18, fontWeight: "800" },
  row: { fontSize: 14 },
  sub: { fontSize: 14, opacity: 0.7 },
  err: { color: "#b91c1c", fontWeight: "700" },
  btn: {
    backgroundColor: "#9bac70",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  btnText: { color: "#fff", fontWeight: "800" },
});
