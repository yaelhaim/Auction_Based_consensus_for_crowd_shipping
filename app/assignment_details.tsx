// app/assignment_details.tsx
// Assignment details (sender/rider/driver) – full screen layout with diagonal hero wave.
// UI: Hebrew. Comments: English.

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import Svg, { Path } from "react-native-svg";

import {
  listSenderRequests,
  listRiderRequests,
  listMyCourierOffers,
  checkOfferMatchStatus,
  getAssignmentByRequest,
  BASE_URL,
  type RequestRow,
  type RiderRequestRow,
  type CourierOfferRow,
  type AssignmentDetailOut,
} from "../lib/api";

// --- Hero images ---
const pkgImg = require("../assets/images/package_image.png");
const rideImg = require("../assets/images/green_car.png");

type Role = "sender" | "rider" | "driver";

type RequestLite = {
  id: string;
  type: "package" | "ride" | "passenger";
  from_address?: string | null;
  to_address?: string | null;
  window_start?: string | null;
  window_end?: string | null;
};

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

  const [resolvedRequestId, setResolvedRequestId] = useState<string | null>(
    null
  );
  const [assignment, setAssignment] = useState<AssignmentDetailOut | null>(
    null
  );
  const [requestMeta, setRequestMeta] = useState<RequestLite | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // ---------- Step 1: resolve requestId ----------
  useEffect(() => {
    let cancelled = false;

    async function resolveRequestId() {
      setLoading(true);
      setError(null);

      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();

      try {
        if (!token) throw new Error("missing token");
        const r: Role = (role as Role) || "sender";

        if (r === "sender") {
          if (requestId) {
            setResolvedRequestId(String(requestId));
          } else {
            const buckets: ("active" | "open")[] = ["active", "open"];
            let found: RequestRow | null = null;
            for (const b of buckets) {
              const rows = await listSenderRequests(String(token), b, {
                limit: 50,
              });
              found = rows[0] ?? null;
              if (found) break;
            }
            if (!found) throw new Error("לא נמצאה בקשה להצגה");
            setResolvedRequestId(String(found.id));
          }
        } else if (r === "rider") {
          if (requestId) {
            setResolvedRequestId(String(requestId));
          } else {
            const buckets: ("active" | "open")[] = ["active", "open"];
            let found: RiderRequestRow | null = null;
            for (const b of buckets) {
              const rows = await listRiderRequests(String(token), b, {
                limit: 50,
              });
              found = rows[0] ?? null;
              if (found) break;
            }
            if (!found) throw new Error("לא נמצאה בקשה להצגה");
            setResolvedRequestId(String(found.id));
          }
        } else {
          // driver
          if (requestId) {
            setResolvedRequestId(String(requestId));
          } else if (offerId) {
            let reqId = "";
            try {
              const st = await checkOfferMatchStatus(
                String(token),
                String(offerId)
              );
              if (st?.status === "matched" && (st.request_id || st.requestId)) {
                reqId = String(st.request_id || st.requestId);
              }
            } catch {}
            if (!reqId) {
              const assigned: CourierOfferRow[] = await listMyCourierOffers(
                String(token),
                {
                  status: "assigned",
                  limit: 50,
                }
              );
              const mine = assigned.find(
                (o) => String(o.id) === String(offerId)
              );
              if ((mine as any)?.request_id)
                reqId = String((mine as any).request_id);
            }
            if (!reqId) throw new Error("לא נמצאה התאמה להצעה זו עדיין");
            setResolvedRequestId(reqId);
          } else {
            throw new Error("חסר מזהה הצעה או בקשה");
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "שגיאה בטעינת הנתונים");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    resolveRequestId();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [role, token, requestId, offerId]);

  // ---------- Step 2: fetch assignment + ensure we use the true request_id ----------
  useEffect(() => {
    if (!resolvedRequestId) return;

    const id: string = resolvedRequestId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const MAX_WAIT_MS = 10_000;
    const INTERVAL_MS = 1_000;
    const t0 = Date.now();

    async function fetchAssignmentAndRequest() {
      setLoading(true);
      setError(null);
      try {
        const data = await getAssignmentByRequest(id);
        if (cancelled) return;

        // If server says different request_id (fresh match), resync:
        if (data.request_id && data.request_id !== id) {
          setResolvedRequestId(data.request_id);
          setLoading(false);
          return;
        }

        setAssignment(data);

        // Prefer request from the assignment payload
        const reqFromApi = (data as any).request as RequestLite | undefined;
        if (reqFromApi && reqFromApi.id) {
          setRequestMeta(reqFromApi);
        } else {
          try {
            const res = await fetch(
              `${BASE_URL}/requests/${encodeURIComponent(id)}`
            );
            if (res.ok) {
              const r = (await res.json()) as RequestLite;
              setRequestMeta(r);
            } else {
              setRequestMeta(null);
            }
          } catch {
            setRequestMeta(null);
          }
        }

        setLoading(false);
      } catch (e: any) {
        const msg = e?.message || "";
        const is404 =
          msg.includes("No assignment found") ||
          msg.includes("HTTP 404") ||
          msg.includes("404");
        if (!is404 || Date.now() - t0 > MAX_WAIT_MS) {
          if (!cancelled) {
            setError(msg || "שגיאה בטעינת ההתאמה");
            setLoading(false);
          }
          return;
        }
        timer = setTimeout(
          () => !cancelled && fetchAssignmentAndRequest(),
          INTERVAL_MS
        );
      }
    }

    fetchAssignmentAndRequest();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [resolvedRequestId]);

  function goHome() {
    router.replace({
      pathname: (home as any) || "/home_page",
      params: { token },
    });
  }

  // ---------- UI states ----------
  if (loading) {
    return (
      <View style={S.centerWrap}>
        <ActivityIndicator />
        <Text style={S.sub}>טוען נתונים…</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={S.centerWrap}>
        <Text style={S.err}>{error}</Text>
        <TouchableOpacity onPress={goHome} style={S.btn}>
          <Text style={S.btnText}>חזרה</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!assignment) return null;

  // ---------- Derived display data ----------
  const d = assignment.driver;
  const req = requestMeta || (assignment as any).request;
  const t = ((req?.type as string) || "").toLowerCase();
  const isPackage = t === "package";
  const isPassenger = t === "ride" || t === "passenger";

  const kind = isPackage ? "איסוף חבילה" : "טרמפ";
  const heroImage = isPackage ? pkgImg : rideImg;

  const callEnabled = !!d.phone;
  const onCall = () => d.phone && Linking.openURL(`tel:${d.phone}`);

  const assignedLocal = new Date(assignment.assigned_at).toLocaleString();

  const ratingNumber = typeof d.rating === "number" ? d.rating : null;
  const ratingLabel = ratingNumber == null ? "חדש" : ratingNumber.toFixed(1);

  return (
    <View style={S.page}>
      {/* Diagonal green wave (covers ~55% height) */}
      <GreenDiagonalWave />

      {/* Hero image – large & present */}
      <View style={S.heroWrap}>
        <Image source={heroImage} style={S.heroImg} resizeMode="contain" />
      </View>

      {/* Bottom details */}
      <View style={S.details}>
        <Text style={S.kind}>{kind}</Text>

        <View style={S.tagsRow}>
          {req?.from_address ? <Tag text={req.from_address!} /> : null}
          {req?.to_address ? <Tag text={req.to_address!} /> : null}
        </View>

        <View style={S.driverRow}>
          <Image
            source={{
              uri: d.avatar_url || "https://ui-avatars.com/api/?name=Driver",
            }}
            style={S.avatar}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={S.name} numberOfLines={1}>
              {d.full_name || "נהג ללא שם"}
            </Text>
            <RatingStars rating={ratingNumber} label={ratingLabel} />
          </View>
          <TouchableOpacity
            onPress={onCall}
            disabled={!callEnabled}
            style={[S.callBtn, !callEnabled && { opacity: 0.5 }]}
          >
            <Text style={S.callBtnText}>
              {callEnabled ? "התקשר" : "אין טלפון"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={S.infoRow}>
          <InfoItem label="סטטוס" value={prettyStatus(assignment.status)} />
          <InfoItem label="שעת שיוך" value={assignedLocal} />
        </View>

        <TouchableOpacity onPress={goHome} style={[S.btn, { marginTop: 20 }]}>
          <Text style={S.btnText}>חזרה</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ---------------- UI helpers ---------------- */

function prettyStatus(s: string) {
  return s.replaceAll("_", " ");
}

function Tag({ text }: { text: string }) {
  return (
    <View style={S.tag}>
      <Text style={S.tagText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function RatingStars({
  rating,
  label,
}: {
  rating: number | null;
  label: string;
}) {
  if (rating == null) {
    return <Text style={S.dimSmall}>{label}</Text>; // "חדש"
  }
  const clamped = Math.max(0, Math.min(5, rating));
  const full = Math.floor(clamped);
  const hasHalf = clamped - full >= 0.5;
  const stars = "★★★★★".split("");

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={S.stars}>
        {stars
          .map((_, i) => {
            if (i < full) return "★";
            if (i === full && hasHalf) return "⯪";
            return "☆";
          })
          .join("")}
      </Text>
      <Text style={S.dimSmall}>{label}</Text>
    </View>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={S.infoLabel}>{label}</Text>
      <Text style={S.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/* -------- Diagonal wave SVG (covers ~55% of screen height) -------- */
function GreenDiagonalWave() {
  const { width, height: screenH } = Dimensions.get("window");
  const h = Math.max(300, Math.floor(screenH * 0.55));

  // Diagonal wave from top-left to ~mid-bottom with a soft curve
  // Points:
  // (0,0) → (width,0) → (width, h*0.35) → curve back to (0, h*0.9) → close
  const d = `
    M 0 0
    H ${width}
    V ${h * 0.35}
    C ${width * 0.7} ${h * 0.55}, ${width * 0.35} ${h * 0.75}, 0 ${h * 0.9}
    Z
  `;

  return (
    <Svg
      width={width}
      height={h}
      style={S.waveSvg}
      viewBox={`0 0 ${width} ${h}`}
    >
      <Path d={d} fill={GREEN} />
    </Svg>
  );
}

/* ---------------- Styles ---------------- */

const GREEN = "#9bac70";
const BG = "#f7f7f5";
const TXT = "#0b0b0b";

const S = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: BG,
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  sub: { fontSize: 14, opacity: 0.7 },
  err: { color: "#b91c1c", fontWeight: "700" },

  waveSvg: {
    position: "absolute",
    top: 0,
    left: 0,
  },

  heroWrap: {
    // push down so image sits nicely on the diagonal wave
    marginTop: Platform.select({ ios: 120, android: 100 }),
    marginHorizontal: 16,
    borderRadius: 28,
    overflow: "hidden",
    // soften shadows on iOS; elevation on Android
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
    backgroundColor: "transparent", // avoid any black box behind PNGs
  },
  heroImg: {
    width: "100%",
    height: 280, // bigger & more present
    backgroundColor: "transparent", // avoid dark fill under alpha
  },

  details: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 22,
    gap: 12,
  },

  kind: {
    fontSize: 22,
    fontWeight: "800",
    color: TXT,
  },

  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  tag: {
    backgroundColor: "#eef2e6",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    maxWidth: "100%",
  },
  tagText: { color: TXT },

  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#e5e7eb",
  },
  name: {
    fontSize: 18,
    fontWeight: "700",
    color: TXT,
  },
  dimSmall: { color: "#6b7280", fontSize: 12 },
  stars: { color: "#f59e0b", fontSize: 16 },

  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    marginTop: 6,
  },
  infoLabel: { color: "#6b7280", fontSize: 12 },
  infoValue: { color: TXT, fontWeight: "600" },

  btn: {
    backgroundColor: GREEN,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignSelf: "center",
    marginTop: 8,
  },
  btnText: { color: "#fff", fontWeight: "800" },

  callBtn: {
    backgroundColor: GREEN,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  callBtnText: { color: "#fff", fontWeight: "800" },
});
