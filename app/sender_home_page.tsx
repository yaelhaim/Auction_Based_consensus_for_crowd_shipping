// app/sender_home_page.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import {
  getMyProfile,
  getSenderMetrics,
  listSenderRequests,
  type SenderMetrics,
  type RequestRow,
  type SenderBucket,
} from "../lib/api";
import { ListCard, ActionBanner } from "./components/Primitives";
import { COLORS } from "./ui/theme";

const H = Dimensions.get("window").height;

export default function SenderHome() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [firstName, setFirstName] = useState("");
  const [tab, setTab] = useState<SenderBucket>("open");
  const [items, setItems] = useState<RequestRow[]>([]);
  const [metrics, setMetrics] = useState<SenderMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const me: any = await getMyProfile(String(token));
        setFirstName(me?.first_name || "");
      } catch {}
    })();
  }, [token]);

  const loadAll = useCallback(
    async (bucket: SenderBucket) => {
      if (!token) return;
      setLoading(true);
      try {
        const [m, listRaw] = await Promise.all([
          getSenderMetrics(String(token)),
          listSenderRequests(String(token), bucket),
        ]);
        // Safety net: keep only sender-type requests (exclude rides, if any)
        const filtered = (listRaw ?? []).filter(
          (r: any) => r?.type !== "ride"
        ) as RequestRow[];
        setMetrics(m);
        setItems(filtered);
      } catch (e: any) {
        Alert.alert("שגיאה", e?.message || "טעינת הדף נכשלה");
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    loadAll(tab);
  }, [tab, loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll(tab);
    setRefreshing(false);
  }, [tab, loadAll]);

  const tabTitle = useMemo(
    () => (tab === "open" ? "פתוחות" : tab === "active" ? "פעילות" : "הושלמו"),
    [tab]
  );

  function newRequest() {
    router.push({
      pathname: "/sender_request_create",
      params: { token: String(token ?? "") },
    });
  }

  const Header = (
    <>
      {/* FULL-WIDTH brown section that SCROLLS; rounded bottom corners */}
      <View style={[S.topPanel, { minHeight: H * 0.46 }]}>
        <View style={S.avatarWrap}>
          <View style={S.avatarCircle}>
            <Ionicons name="person" size={30} color={COLORS.text} />
          </View>
        </View>

        <Text style={S.hello}>היי{firstName ? `, ${firstName}` : ""}</Text>

        {/* Compact white KPI pills (slightly raised from bottom) */}
        <View style={S.kpiBarPinned}>
          <View style={S.kpiPill}>
            <Text style={S.kpiPillVal}>{metrics?.open_count ?? 0}</Text>
            <Text style={S.kpiPillLabel}>פתוחות</Text>
          </View>
          <View style={S.kpiPill}>
            <Text style={S.kpiPillVal}>{metrics?.active_count ?? 0}</Text>
            <Text style={S.kpiPillLabel}>בפעילות</Text>
          </View>
          <View style={S.kpiPill}>
            <Text style={S.kpiPillVal}>{metrics?.delivered_count ?? 0}</Text>
            <Text style={S.kpiPillLabel}>הושלמו</Text>
          </View>
        </View>
      </View>

      {/* Action cards under the brown header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <ActionBanner
          title="צפייה בבקשות פתוחות"
          subtitle="בקשות שמחכות לשיבוץ"
          active={tab === "open"}
          onPress={() => setTab("open")}
        />
        <ActionBanner
          title="צפייה במשלוחים בפעילות"
          subtitle="משלוחים בדרך / שובצו לשליח"
          active={tab === "active"}
          onPress={() => setTab("active")}
        />
        <ActionBanner
          title="צפייה במשלוחים שהושלמו"
          subtitle="היסטוריית המשלוחים שלך"
          active={tab === "delivered"}
          onPress={() => setTab("delivered")}
        />

        <Text style={S.sectionTitle}>רשימת {tabTitle}</Text>
      </View>
    </>
  );

  return (
    <View style={S.screen}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{
          paddingBottom: 72, // space for bottom full-width button
        }}
        ListHeaderComponent={Header}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: 16 }}>
            <ListCard
              title={`${item.from_address} → ${item.to_address}`}
              subtitle={`${fmtWindow(
                item.window_start,
                item.window_end
              )} • ${statusLabel(item.status)} • ${
                item.type === "package" ? "חבילה" : "טרמפ"
              }`}
              tone="primary"
            />
          </View>
        )}
        ListEmptyComponent={
          <Text style={S.empty}>
            {loading ? "טוען…" : `אין פריטים בקטגוריה "${tabTitle}"`}
          </Text>
        }
      />

      {/* Full-width sticky bottom button (edge-to-edge, square) */}
      <TouchableOpacity
        style={S.fullWidthBarBtn}
        onPress={newRequest}
        activeOpacity={0.9}
      >
        <Text style={S.fullWidthBarBtnTxt}>הוספת בקשה</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ---------------- helpers ---------------- */
function statusLabel(s: RequestRow["status"]) {
  return s === "open"
    ? "פתוחה"
    : s === "assigned"
    ? "שובץ שליח"
    : s === "in_transit"
    ? "בדרך"
    : s === "completed"
    ? "הושלם"
    : "בוטל";
}
function fmtDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(
    d.getMonth() + 1
  ).padStart(2, "0")}.${d.getFullYear()}`;
}
function fmtTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}
function fmtWindow(s?: string | null, e?: string | null) {
  if (s && e) {
    const same = fmtDate(s) === fmtDate(e);
    return same
      ? `חלון: ${fmtDate(s)} ${fmtTime(s)}–${fmtTime(e)}`
      : `חלון: ${fmtDate(s)} ${fmtTime(s)} → ${fmtDate(e)} ${fmtTime(e)}`;
  }
  if (s) return `זמין מ: ${fmtDate(s)} ${fmtTime(s)}`;
  if (e) return `עד: ${fmtDate(e)} ${fmtTime(e)}`;
  return "ללא חלון זמן";
}

/* ---------------- styles ---------------- */
const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },

  // FULL-WIDTH mocha section (scrolls with content) with rounded bottom corners
  topPanel: {
    backgroundColor: COLORS.softMocha,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    marginTop: 0,
    marginHorizontal: 0,
    paddingTop: 32,
    paddingBottom: 78, // room for KPI pills
    paddingHorizontal: 16,
    position: "relative",
    alignItems: "center",
  },

  // Avatar
  avatarWrap: {
    width: "100%",
    alignItems: "center",
    marginTop: 10,
    marginBottom: 8,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  hello: {
    marginTop: 8,
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.text,
    textAlign: "center",
    writingDirection: "ltr",
  },

  // White KPI pills (slightly raised from bottom)
  kpiBarPinned: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 30,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kpiPill: {
    width: 92,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: "#fff",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  kpiPillVal: { fontWeight: "900", fontSize: 17, textAlign: "center" },
  kpiPillLabel: {
    color: COLORS.dim,
    fontSize: 12,
    marginTop: 3,
    textAlign: "center",
  },

  sectionTitle: {
    marginTop: 16,
    marginBottom: 8,
    fontWeight: "900",
    color: COLORS.primaryDark,
    textAlign: "left",
  },

  empty: {
    textAlign: "center",
    color: COLORS.dim,
    marginTop: 18,
    paddingHorizontal: 16,
  },

  // Full-width sticky bottom button (edge-to-edge, no radius)
  fullWidthBarBtn: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 56,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  fullWidthBarBtnTxt: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 16,
  },
});
