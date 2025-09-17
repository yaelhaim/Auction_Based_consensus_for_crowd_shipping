import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router"; // ← add useRouter
import {
  getMyProfile,
  getSenderMetrics,
  listSenderRequests,
  type SenderMetrics,
  type RequestRow,
  type SenderBucket,
} from "../lib/api";
import {
  Header,
  KPI,
  HeroCard,
  RewardBanner,
  ListCard,
} from "./components/Primitives";
import { COLORS } from "./ui/theme";

export default function SenderHome() {
  const router = useRouter(); // ← router for navigation
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
      const me = await getMyProfile(String(token));
      setFirstName(me?.first_name || "");
    })();
  }, [token]);

  const loadAll = useCallback(
    async (bucket: SenderBucket) => {
      if (!token) return;
      setLoading(true);
      try {
        const [m, list] = await Promise.all([
          getSenderMetrics(String(token)),
          listSenderRequests(String(token), bucket),
        ]);
        setMetrics(m);
        setItems(list);
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

  // Compute current tab label (Hebrew)
  const tabTitle = useMemo(
    () => (tab === "open" ? "פתוחות" : tab === "active" ? "פעילות" : "הושלמו"),
    [tab]
  );

  // Bottom CTA: navigate to Create Request screen (passes token)
  function newRequest() {
    router.push({
      pathname: "/sender_request_create",
      params: { token: String(token ?? "") },
    });
  }

  // Smart “tip” banner content (instead of weekly reward)
  function smartTip(): { title: string; subtitle: string } {
    if (!metrics)
      return {
        title: "טיפ: התחילי בבקשה חדשה",
        subtitle: "לחצי על הכפתור הירוק בתחתית",
      };
    if ((metrics.open_count ?? 0) === 0)
      return {
        title: "אין בקשות פתוחות",
        subtitle: "לחצי על 'יצירת בקשת משלוח' כדי להתחיל",
      };
    if ((metrics.active_count ?? 0) === 0)
      return {
        title: "טיפ: הגדירי חלון זמן",
        subtitle: "חלון זמן ברור עוזר למציאת שליח מהר יותר",
      };
    return {
      title: "תזכורת שימושית",
      subtitle: "עקבי אחרי המשלוחים הפעילים בלשונית 'פעילות'",
    };
  }

  // Pick the “latest request” card content
  const latestId = items[0]?.id ? `ID: ${items[0].id}` : "ID: —";

  return (
    <View style={S.screen}>
      <Header
        title={`היי${firstName ? `, ${firstName}` : ""}`}
        subtitle="ברוכה הבאה למסך הבית של השולחים"
      />

      {/* KPIs */}
      <View style={S.kpiRow}>
        <KPI title="בקשות פתוחות" value={metrics?.open_count ?? 0} />
        <KPI title="משלוחים פעילים" value={metrics?.active_count ?? 0} />
        <KPI title="הושלמו" value={metrics?.delivered_count ?? 0} />
      </View>

      {/* Tabs directly under KPIs */}
      <View style={S.tabs}>
        {(["open", "active", "delivered"] as SenderBucket[]).map((b) => (
          <TouchableOpacity
            key={b}
            onPress={() => setTab(b)}
            style={[S.tabBtn, tab === b && S.tabBtnActive]}
          >
            <Text style={[S.tabTxt, tab === b && S.tabTxtActive]}>
              {b === "open" ? "פתוחות" : b === "active" ? "פעילות" : "הושלמו"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* “Latest request” hero */}
      <HeroCard
        title="הבקשה האחרונה"
        idText={latestId}
        tone="mocha"
        style={{ marginTop: 10 }}
      />

      {/* Smart tip banner */}
      <RewardBanner
        title={smartTip().title}
        subtitle={smartTip().subtitle}
        tone="primary"
      />

      {/* List */}
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingTop: 10, paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <Text style={S.empty}>
            {loading ? "טוען…" : `אין פריטים בקטגוריה "${tabTitle}"`}
          </Text>
        }
        renderItem={({ item }) => (
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
        )}
      />

      {/* Bottom full-width CTA */}
      <TouchableOpacity
        style={S.bottomBar}
        activeOpacity={0.9}
        onPress={newRequest}
      >
        <Text style={S.bottomBarText}>יצירת בקשת משלוח</Text>
      </TouchableOpacity>
    </View>
  );
}

/* helpers */
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

const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg, padding: 16 },
  kpiRow: { flexDirection: "row-reverse", marginTop: 4, marginBottom: 10 },
  tabs: {
    flexDirection: "row-reverse",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    overflow: "hidden",
    marginTop: 8,
  },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabTxt: { color: COLORS.primaryDark, fontWeight: "700" },
  tabTxtActive: { color: "#fff" },
  empty: { textAlign: "center", color: COLORS.dim, marginTop: 18 },

  // Bottom full-width CTA styles
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 16,
    backgroundColor: COLORS.primary,
    alignItems: "center",
  },
  bottomBarText: { color: "#fff", fontWeight: "900", fontSize: 16 },
});
