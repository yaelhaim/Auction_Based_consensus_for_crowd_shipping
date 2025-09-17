import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  getMyProfile,
  getRiderMetrics,
  listRiderRequests,
  type RiderMetrics,
  type RiderRequestRow,
  type RiderBucket,
} from "../lib/api";
import {
  Header,
  KPI,
  HeroCard,
  RewardBanner,
  ListCard,
} from "./components/Primitives";
import { COLORS } from "./ui/theme";

export default function RiderHome() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [name, setName] = useState("");
  const [tab, setTab] = useState<RiderBucket>("open");
  const [items, setItems] = useState<RiderRequestRow[]>([]);
  const [metrics, setMetrics] = useState<RiderMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) return;
      const me = await getMyProfile(String(token));
      setName(me?.first_name || "");
    })();
  }, [token]);

  const loadAll = useCallback(
    async (b: RiderBucket) => {
      if (!token) return;
      setLoading(true);
      try {
        const [m, list] = await Promise.all([
          getRiderMetrics(String(token)),
          listRiderRequests(String(token), b),
        ]);
        setMetrics(m);
        setItems(list);
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

  const tabLabel = useMemo(
    () => (tab === "open" ? "פתוחות" : tab === "active" ? "פעילות" : "הושלמו"),
    [tab]
  );

  function openNewRide() {
    Alert.alert("בקרוב", "מסך חיפוש/יצירת טרמפ ✨");
  }

  function smartTip(): { title: string; subtitle: string } {
    if (!metrics)
      return {
        title: "טיפ: מצאי טרמפ מוקדם",
        subtitle: "נסיעות מבוקשות נסגרות מהר",
      };
    if ((metrics.open_count ?? 0) === 0)
      return {
        title: "אין בקשות פתוחות",
        subtitle: "לחצי על הכפתור הירוק כדי להתחיל חיפוש",
      };
    if ((metrics.active_count ?? 0) === 0)
      return {
        title: "טיפ: הגדירי חלון זמן",
        subtitle: "טווח שעות רחב יותר מגדיל סיכויי התאמה",
      };
    return {
      title: "תזכורת שימושית",
      subtitle: "עקבי אחרי הנסיעות הפעילות בלשונית 'פעילות'",
    };
  }

  const latestId = items[0]?.id ? `ID: ${items[0].id}` : "ID: —";

  return (
    <View style={S.screen}>
      <Header
        title={`היי${name ? `, ${name}` : ""}`}
        subtitle="ברוכים הבאים למסך הבית למחפשי טרמפ"
      />

      {/* KPIs */}
      <View style={S.kpiRow}>
        <KPI title="פתוחות" value={metrics?.open_count ?? 0} />
        <KPI title="בדרך" value={metrics?.active_count ?? 0} />
        <KPI title="הושלמו" value={metrics?.completed_count ?? 0} />
      </View>

      {/* Tabs directly under KPIs */}
      <View style={S.tabs}>
        {(["open", "active", "completed"] as RiderBucket[]).map((b) => (
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

      {/* Latest request hero */}
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

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingTop: 10, paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <Text style={S.empty}>
            {loading ? "טוען…" : `אין פריטים בקטגוריה "${tabLabel}"`}
          </Text>
        }
        renderItem={({ item }) => (
          <ListCard
            title={`${item.from_address} → ${item.to_address}`}
            subtitle={`${fmtWindow(
              item.window_start,
              item.window_end
            )} • ${statusLabel(item.status)} • טרמפ`}
            tone="primary"
          />
        )}
      />

      {/* Bottom full-width CTA */}
      <TouchableOpacity
        style={S.bottomBar}
        activeOpacity={0.9}
        onPress={openNewRide}
      >
        <Text style={S.bottomBarText}>מצאו טרמפ</Text>
      </TouchableOpacity>
    </View>
  );
}

function statusLabel(s: RiderRequestRow["status"]) {
  return s === "open"
    ? "פתוחה"
    : s === "matched"
    ? "שובץ נהג"
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
