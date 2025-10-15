// app/courier_home_page.tsx
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
  getCourierMetrics,
  listCourierJobs,
  listMyCourierOffers,
  type CourierMetrics,
  type CourierJobRow,
  type CourierBucket,
  type CourierOfferRow,
} from "../lib/api";
import { ListCard, ActionBanner } from "./components/Primitives";
import { COLORS } from "./ui/theme";

const H = Dimensions.get("window").height;

export default function CourierHome() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [firstName, setFirstName] = useState("");
  const [tab, setTab] = useState<CourierBucket>("available");

  const [jobs, setJobs] = useState<CourierJobRow[]>([]);
  const [offers, setOffers] = useState<CourierOfferRow[]>([]);
  const [metrics, setMetrics] = useState<CourierMetrics | null>(null);
  const [offersActiveCount, setOffersActiveCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadKpis = useCallback(async () => {
    if (!token) return;
    const [m, myActiveOffers] = await Promise.all([
      getCourierMetrics(String(token)),
      listMyCourierOffers(String(token), {
        status: "active",
        limit: 200,
        offset: 0,
      }),
    ]);
    setMetrics(m);
    setOffersActiveCount(myActiveOffers.length);
  }, [token]);

  const loadForTab = useCallback(
    async (b: CourierBucket) => {
      if (!token) return;
      setLoading(true);
      try {
        await loadKpis();
        if (b === "available") {
          const myOffers = await listMyCourierOffers(String(token), {
            limit: 50,
            offset: 0,
          });
          setOffers(myOffers);
          setJobs([]);
        } else {
          const list = await listCourierJobs(String(token), b);
          setJobs(list);
          setOffers([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [token, loadKpis]
  );

  const loadAll = useCallback(async () => {
    await loadForTab(tab);
  }, [tab, loadForTab]);

  useEffect(() => {
    (async () => {
      if (!token) return;
      const me = await getMyProfile(String(token));
      setFirstName(me?.first_name || "");
    })();
  }, [token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const tabTitle = useMemo(
    () =>
      tab === "available" ? "זמינות" : tab === "active" ? "פעילות" : "הושלמו",
    [tab]
  );

  function openNewAvailability() {
    if (!token) {
      Alert.alert("שגיאה", "חסרים פרטי התחברות (token)");
      return;
    }
    router.push({ pathname: "/courier_offer_create", params: { token } });
  }

  function smartTip(): { title: string; subtitle: string } {
    if (tab === "available") {
      if (!offers.length)
        return {
          title: "אין זמינות רשומה",
          subtitle: "לחצו על 'בדיקת זמינות' כדי לפרסם",
        };
      return {
        title: "טיפ: עדכנו חלון זמן",
        subtitle: "טווח רחב מגדיל התאמות עם בקשות פתוחות",
      };
    }
    if (!metrics)
      return {
        title: "טיפ: בדוק משימות חדשות",
        subtitle: "המשימות מתעדכנות לאורך היום",
      };
    if ((metrics.active_count ?? 0) === 0)
      return {
        title: "אין משימות פעילות",
        subtitle: "בדוק שוב מאוחר יותר או הפעל התראות",
      };
    return {
      title: "זכרו לעדכן סטטוס",
      subtitle: "סמנו 'בדרך' ו'הושלם' כדי שהשולח יתעדכן",
    };
  }

  const Header = (
    <>
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

        {/* KPI Pills — זמינות/בביצוע/הושלמו */}
        <View style={S.kpiBarPinned}>
          <View style={S.kpiPill}>
            <Text style={S.kpiPillVal}>{offersActiveCount}</Text>
            <Text style={S.kpiPillLabel}>זמינות</Text>
          </View>
          <View style={S.kpiPill}>
            <Text style={S.kpiPillVal}>{metrics?.active_count ?? 0}</Text>
            <Text style={S.kpiPillLabel}>בביצוע</Text>
          </View>
          <View style={S.kpiPill}>
            <Text style={S.kpiPillVal}>{metrics?.delivered_count ?? 0}</Text>
            <Text style={S.kpiPillLabel}>הושלמו</Text>
          </View>
        </View>
      </View>

      {/* אריחי פעולה — כמו אצל השולחת */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <ActionBanner
          title="צפייה בזמינויות"
          subtitle="הזמנויות חדשות לאיסוף"
          active={tab === "available"}
          onPress={() => setTab("available")}
        />
        <ActionBanner
          title="צפייה במשימות פעילות"
          subtitle="משימות ששובצו/בדרך"
          active={tab === "active"}
          onPress={() => setTab("active")}
        />
        <ActionBanner
          title="צפייה במשימות שהושלמו"
          subtitle="היסטוריית ביצועים"
          active={tab === "delivered"}
          onPress={() => setTab("delivered")}
        />

        <Text style={S.sectionTitle}>רשימת {tabTitle}</Text>
      </View>
    </>
  );

  return (
    <View style={S.screen}>
      {/* Lists */}
      {tab === "available" ? (
        <FlatList<CourierOfferRow>
          data={offers}
          keyExtractor={(it) => it.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={{ paddingBottom: 72 }}
          ListHeaderComponent={Header}
          renderItem={({ item }) => (
            <View style={{ paddingHorizontal: 16 }}>
              <ListCard
                title={`${item.from_address} → ${item.to_address || "כל יעד"}`}
                subtitle={`${offerRange(
                  item.window_start,
                  item.window_end
                )} • סטטוס: ${item.status} • סוגים: ${item.types.join(", ")}`}
                tone="primary"
              />
            </View>
          )}
          ListEmptyComponent={
            <Text style={S.empty}>
              {loading ? "טוען…" : `אין פריטים בקטגוריה "זמינות"`}
            </Text>
          }
        />
      ) : (
        <FlatList<CourierJobRow>
          data={jobs}
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
      )}

      {/* כפתור מלא-רוחב דבוק לתחתית */}
      <TouchableOpacity
        style={S.fullWidthBarBtn}
        onPress={openNewAvailability}
        activeOpacity={0.9}
      >
        <Text style={S.fullWidthBarBtnTxt}>בדיקת זמינות</Text>
      </TouchableOpacity>
    </View>
  );
}

/* helpers */
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
function offerRange(s?: string | null, e?: string | null) {
  if (!s && !e) return "";
  if (s && e) {
    const same = fmtDate(s) === fmtDate(e);
    return same
      ? `${fmtDate(s)} ${fmtTime(s)}–${fmtTime(e)}`
      : `${fmtDate(s)} ${fmtTime(s)} → ${fmtDate(e)} ${fmtTime(e)}`;
  }
  if (s) return `מ־${fmtDate(s)} ${fmtTime(s)}`;
  return `עד־${fmtDate(e!)} ${fmtTime(e!)}`;
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
