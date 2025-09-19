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
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
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
import {
  Header,
  KPI,
  HeroCard,
  RewardBanner,
  ListCard,
} from "./components/Primitives";
import { COLORS } from "./ui/theme";

export default function CourierHome() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [name, setName] = useState("");
  const [tab, setTab] = useState<CourierBucket>("available");

  const [jobs, setJobs] = useState<CourierJobRow[]>([]);
  const [offers, setOffers] = useState<CourierOfferRow[]>([]);
  const [metrics, setMetrics] = useState<CourierMetrics | null>(null);

  // KPI חדש: כמה זמינויות פעילות יש לי כרגע (courier_offers.status='active')
  const [offersActiveCount, setOffersActiveCount] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ---------- loaders ----------
  // טען תמיד: metrics (jobs) + ספירת זמינויות פעילות
  const loadKpis = useCallback(async () => {
    if (!token) return;
    const [m, myActiveOffers] = await Promise.all([
      getCourierMetrics(String(token)),
      // נטען רק את הפעילות כדי לספור ל-KPI; limit גבוה כדי לכסות בקלות
      listMyCourierOffers(String(token), {
        status: "active",
        limit: 200,
        offset: 0,
      }),
    ]);
    setMetrics(m);
    setOffersActiveCount(myActiveOffers.length);
  }, [token]);

  // טען תוכן לפי טאב (רשימות)
  const loadForTab = useCallback(
    async (b: CourierBucket) => {
      if (!token) return;
      setLoading(true);
      try {
        // נתחיל מקופסאות ה-KPI כדי שתהיה תחושה מהירה של עדכון
        await loadKpis();

        if (b === "available") {
          // לטאב זמינות: מציגים את ההצעות שלי (כל הסטטוסים, לפי תאריך)
          const myOffers = await listMyCourierOffers(String(token), {
            limit: 50,
            offset: 0,
          });
          setOffers(myOffers);
          setJobs([]);
        } else {
          // לטאבים פעילות/הושלמו: מציגים Jobs
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
      setName(me?.first_name || "");
    })();
  }, [token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useFocusEffect(
    useCallback(() => {
      // רענון אוטומטי כשחוזרים למסך (למשל אחרי יצירת זמינות)
      loadAll();
    }, [loadAll])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  // ---------- UI helpers ----------
  const tabLabel = useMemo(
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

  const latestOffer = offers[0];
  const latestJob = jobs[0];
  const heroTitle = tab === "available" ? "הזמינות האחרונה" : "המשימה האחרונה";
  const heroIdText =
    tab === "available"
      ? offerRange(latestOffer?.window_start, latestOffer?.window_end) || "—"
      : latestJob?.id
      ? `ID: ${latestJob.id}`
      : "ID: —";

  return (
    <View style={S.screen}>
      <Header
        title={`היי${name ? `, ${name}` : ""}`}
        subtitle="ברוכים הבאים למסך הבית של השליחים"
      />

      {/* KPIs */}
      <View style={S.kpiRow}>
        {/* ← עכשיו הקופסה הראשונה מציגה את מספר הזמינויות הפעילות מה-courier_offers */}
        <KPI title="זמינות" value={offersActiveCount} />
        <KPI title="בביצוע" value={metrics?.active_count ?? 0} />
        <KPI title="הושלמו" value={metrics?.delivered_count ?? 0} />
      </View>

      {/* Tabs (כמו אצל השולח/ריידר) */}
      <View style={S.tabs}>
        {(["available", "active", "delivered"] as CourierBucket[]).map((b) => (
          <TouchableOpacity
            key={b}
            onPress={() => setTab(b)}
            style={[S.tabBtn, tab === b && S.tabBtnActive]}
          >
            <Text style={[S.tabTxt, tab === b && S.tabTxtActive]}>
              {b === "available"
                ? "זמינות"
                : b === "active"
                ? "פעילות"
                : "הושלמו"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Hero + Tip */}
      <HeroCard
        title={heroTitle}
        idText={heroIdText}
        tone="mocha"
        style={{ marginTop: 10 }}
      />
      <RewardBanner
        title={smartTip().title}
        subtitle={smartTip().subtitle}
        tone="primary"
      />

      {/* Lists — FlatList נפרד לכל טיפוס כדי לפתור TS */}
      {tab === "available" ? (
        <FlatList<CourierOfferRow>
          data={offers}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ paddingTop: 10, paddingBottom: 140 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <Text style={S.empty}>
              {loading ? "טוען…" : `אין פריטים בקטגוריה "זמינות"`}
            </Text>
          }
          renderItem={({ item }) => (
            <ListCard
              title={`${item.from_address} → ${item.to_address || "כל יעד"}`}
              subtitle={`${offerRange(
                item.window_start,
                item.window_end
              )} • סטטוס: ${item.status} • סוגים: ${item.types.join(", ")}`}
              tone="primary"
            />
          )}
        />
      ) : (
        <FlatList<CourierJobRow>
          data={jobs}
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
              )} • ${statusLabel(item.status)} • ${
                item.type === "package" ? "חבילה" : "טרמפ"
              }`}
              tone="primary"
            />
          )}
        />
      )}

      {/* Bottom full-width CTA */}
      <TouchableOpacity
        style={S.bottomBar}
        activeOpacity={0.9}
        onPress={openNewAvailability}
      >
        <Text style={S.bottomBarText}>בדיקת זמינות</Text>
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
  screen: { flex: 1, backgroundColor: COLORS.bg, padding: 16 },
  kpiRow: { flexDirection: "row-reverse", marginTop: 4, marginBottom: 10 },

  // Tabs — אותו עיצוב כמו בשאר הדפים
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
