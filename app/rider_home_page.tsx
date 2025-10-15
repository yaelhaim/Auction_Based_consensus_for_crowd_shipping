// app/rider_home_page.tsx
import React, { useEffect, useState, useCallback, useMemo } from "react";
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
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

import {
  getMyProfile,
  getRiderMetrics,
  listRiderRequests,
  type RiderMetrics,
  type RiderRequestRow,
  type RiderBucket,
} from "../lib/api";
import { ListCard, ActionBanner } from "./components/Primitives";
import { COLORS } from "./ui/theme";

const H = Dimensions.get("window").height;

export default function RiderHome() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [firstName, setFirstName] = useState("");
  const [tab, setTab] = useState<RiderBucket>("open");
  const [items, setItems] = useState<RiderRequestRow[]>([]);
  const [metrics, setMetrics] = useState<RiderMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(
    async (bucket: RiderBucket) => {
      if (!token) return;
      setLoading(true);
      try {
        const [m, list] = await Promise.all([
          getRiderMetrics(String(token)),
          listRiderRequests(String(token), bucket),
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
    (async () => {
      if (!token) return;
      const me = await getMyProfile(String(token));
      setFirstName(me?.first_name || "");
    })();
  }, [token]);

  useEffect(() => {
    loadAll(tab);
  }, [tab, loadAll]);

  useFocusEffect(
    useCallback(() => {
      loadAll(tab);
    }, [loadAll, tab])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll(tab);
    setRefreshing(false);
  }, [tab, loadAll]);

  const tabTitle = useMemo(
    () => (tab === "open" ? "פתוחות" : tab === "active" ? "פעילות" : "הושלמו"),
    [tab]
  );

  function openNewRide() {
    if (!token) {
      Alert.alert("שגיאה", "חסרים פרטי התחברות (token)");
      return;
    }
    router.push({ pathname: "/rider_request_create", params: { token } });
  }

  const Header = (
    <>
      {/* חום מלא-רוחב עם פינות תחתונות מעוגלות, ו-KPI לבנים בתחתית */}
      <View style={[S.topPanel, { minHeight: H * 0.46 }]}>
        <View style={S.avatarWrap}>
          <View style={S.avatarCircle}>
            <Ionicons name="person" size={30} color={COLORS.text} />
          </View>
        </View>

        <Text style={S.hello}>
          היי{firstName ? `, ${firstName}` : ""}{" "}
          <Text style={{ fontWeight: "700", color: COLORS.primaryDark }}></Text>
        </Text>

        {/* KPI Pills */}
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
            <Text style={S.kpiPillVal}>{metrics?.completed_count ?? 0}</Text>
            <Text style={S.kpiPillLabel}>הושלמו</Text>
          </View>
        </View>
      </View>

      {/* אריחי פעולה במקום טאב-בר הכחול */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <ActionBanner
          title="צפייה בבקשות פתוחות"
          subtitle="בקשות שמחכות לשיבוץ נהג"
          active={tab === "open"}
          onPress={() => setTab("open")}
        />
        <ActionBanner
          title="צפייה בבקשות פעילות"
          subtitle="בקשות שובצו/בדרך"
          active={tab === "active"}
          onPress={() => setTab("active")}
        />
        <ActionBanner
          title="צפייה בבקשות שהושלמו"
          subtitle="היסטוריית טרמפים"
          active={tab === "completed"}
          onPress={() => setTab("completed")}
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
        contentContainerStyle={{ paddingBottom: 72 }}
        ListHeaderComponent={Header}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: 16 }}>
            <ListCard
              title={`${item.from_address} → ${item.to_address}`}
              subtitle={`${fmtWindow(
                item.window_start,
                item.window_end
              )} • ${statusLabel(item.status)} • טרמפ`}
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

      {/* כפתור מלא-רוחב דבוק לתחתית */}
      <TouchableOpacity
        style={S.fullWidthBarBtn}
        onPress={openNewRide}
        activeOpacity={0.9}
      >
        <Text style={S.fullWidthBarBtnTxt}>הוספת בקשת טרמפ</Text>
      </TouchableOpacity>
    </View>
  );
}

function statusLabel(s: RiderRequestRow["status"]) {
  return s === "open"
    ? "פתוחה"
    : s === "assigned"
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
