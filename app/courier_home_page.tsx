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
  getCourierMetrics,
  listCourierJobs,
  type CourierMetrics,
  type CourierJobRow,
  type CourierBucket,
} from "../lib/api";
import { Header, Chip, KPI, HeroCard, ListCard } from "./components/Primitives";
import { COLORS } from "./ui/theme";

export default function CourierHome() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [name, setName] = useState("");
  const [tab, setTab] = useState<CourierBucket>("available");
  const [items, setItems] = useState<CourierJobRow[]>([]);
  const [metrics, setMetrics] = useState<CourierMetrics | null>(null);
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
    async (b: CourierBucket) => {
      if (!token) return;
      setLoading(true);
      try {
        const [m, list] = await Promise.all([
          getCourierMetrics(String(token)),
          listCourierJobs(String(token), b),
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
    () =>
      tab === "available" ? "זמינות" : tab === "active" ? "פעילות" : "הושלמו",
    [tab]
  );

  function openOffers() {
    Alert.alert("בקרוב", "מסך הצעות זמינות ✨");
  }

  function smartTip(): { title: string; subtitle: string } {
    if (!metrics)
      return {
        title: "טיפ: בדוק הצעות חדשות",
        subtitle: "הצעות מתעדכנות לאורך היום",
      };
    if ((metrics.available_count ?? 0) > 0)
      return {
        title: "יש הצעות זמינות",
        subtitle: "פתח 'הצעות זמינות' כדי לבחור משימה",
      };
    if ((metrics.active_count ?? 0) === 0)
      return {
        title: "אין משימות פעילות",
        subtitle: "בדוק שוב מאוחר יותר או הפעל התראות",
      };
    return {
      title: "זכור לעדכן סטטוס",
      subtitle: "סמן 'בדרך' ו'הושלם' כדי שהשולח יתעדכן",
    };
  }

  const latestId = items[0]?.id ? `ID: ${items[0].id}` : "ID: —";

  return (
    <View style={S.screen}>
      <Header
        title={`היי${name ? `, ${name}` : ""}`}
        subtitle="ברוכים הבאים למסך הבית של השליחים"
      />

      {/* KPIs */}
      <View style={S.kpiRow}>
        <KPI title="זמינות" value={metrics?.available_count ?? 0} />
        <KPI title="בביצוע" value={metrics?.active_count ?? 0} />
        <KPI title="הושלמו" value={metrics?.delivered_count ?? 0} />
      </View>

      {/* Tabs directly under KPIs */}
      <View style={S.tabs}>
        {(["available", "active", "delivered"] as CourierBucket[]).map((b) => (
          <Text
            key={b}
            style={[S.tab, tab === b && S.tabActive]}
            onPress={() => setTab(b)}
          >
            {b === "available"
              ? "זמינות"
              : b === "active"
              ? "פעילות"
              : "הושלמו"}
          </Text>
        ))}
      </View>

      {/* Latest job hero */}
      <HeroCard title="משימה אחרונה" idText={latestId} tone="primary" />

      {/* List */}
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingTop: 10, paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          <Text style={S.tip}>
            {smartTip().title} · {smartTip().subtitle}
          </Text>
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
        onPress={openOffers}
      >
        <Text style={S.bottomBarText}>מצאו הצעות זמינות</Text>
      </TouchableOpacity>
    </View>
  );
}

function statusLabel(s: CourierJobRow["status"]) {
  return s === "open"
    ? "פתוח"
    : s === "assigned"
    ? "שובצת"
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
  tabs: { flexDirection: "row-reverse", gap: 10, marginTop: 12 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    color: COLORS.primaryDark,
    fontWeight: "800",
  },
  tabActive: {
    backgroundColor: COLORS.primary,
    color: "#fff",
    borderColor: COLORS.primary,
  },
  tip: {
    textAlign: "center",
    color: COLORS.dim,
    marginTop: 8,
    marginBottom: 8,
  },

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
