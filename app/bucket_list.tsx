// app/bucket_list.tsx
// One generic "bucket list" screen that serves Sender, Rider, and Courier.
// It reads `role`, `bucket`, and `token` from route params and fetches
// the right dataset. UI strings are in Hebrew; code comments in English.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, RefreshControl, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  listSenderRequests,
  listRiderRequests,
  listCourierJobs,
  listMyCourierOffers,
  type RequestRow,
  type RiderRequestRow,
  type CourierJobRow,
  type CourierOfferRow,
} from "../lib/api";
import { ListCard } from "./components/Primitives";
import { COLORS } from "./ui/theme";

type RoleKey = "sender" | "rider" | "courier";
type SenderBucket = "open" | "active" | "delivered";
type RiderBucket = "open" | "active" | "completed";
type CourierBucket = "available" | "active" | "delivered";

type Params = {
  token?: string;
  role?: RoleKey;
  bucket?: string; // we'll validate at runtime
  title?: string; // optional override for header
};

export default function BucketListScreen() {
  const { token, role, bucket, title } = useLocalSearchParams<Params>();

  const roleKey = (role as RoleKey) ?? "sender";
  const bucketKey = (bucket as string) ?? "open";

  // Shared list state – we keep it as `any[]` and render per kind.
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Human title for the screen
  const screenTitle = useMemo(() => {
    if (title) return title;
    if (roleKey === "sender") {
      return bucketKey === "open"
        ? "בקשות פתוחות"
        : bucketKey === "active"
          ? "בקשות בפעילות"
          : "בקשות שהושלמו";
    }
    if (roleKey === "rider") {
      return bucketKey === "open"
        ? "בקשות פתוחות"
        : bucketKey === "active"
          ? "בקשות פעילות"
          : "בקשות שהושלמו";
    }
    // courier
    return bucketKey === "available"
      ? "זמינויות"
      : bucketKey === "active"
        ? "משימות פעילות"
        : "משימות שהושלמו";
  }, [roleKey, bucketKey, title]);

  // Fetcher that depends on role + bucket
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      if (roleKey === "sender") {
        const rows = await listSenderRequests(
          String(token),
          bucketKey as SenderBucket
        );
        // Keep only "package" for sender as you prefer
        const filtered = (rows ?? []).filter((r: any) => r?.type !== "ride");
        setItems(filtered);
        return;
      }
      if (roleKey === "rider") {
        const rows = await listRiderRequests(
          String(token),
          (bucketKey as RiderBucket) === "completed"
            ? "completed"
            : (bucketKey as RiderBucket)
        );
        setItems(rows ?? []);
        return;
      }
      // courier
      if (bucketKey === "available") {
        const rows = await listMyCourierOffers(String(token), {
          status: "active",
          limit: 200,
          offset: 0,
        });
        setItems(rows ?? []);
      } else {
        const rows = await listCourierJobs(
          String(token),
          bucketKey as CourierBucket
        );
        setItems(rows ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [token, roleKey, bucketKey]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Per-role renderer
  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      if (roleKey === "courier") {
        // Two shapes: Offer (available) vs Job (active/delivered)
        if (bucketKey === "available") {
          const it = item as CourierOfferRow;
          const title = `${it.from_address} → ${it.to_address || "כל יעד"}`;
          const subtitle = `${offerRange(
            it.window_start,
            it.window_end
          )} • סטטוס: ${it.status} • סוגים: ${Array.isArray(it.types) ? it.types.join(", ") : ""}`;
          return (
            <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
              <ListCard title={title} subtitle={subtitle} tone="primary" />
            </View>
          );
        } else {
          const it = item as CourierJobRow;
          const title = `${it.from_address} → ${it.to_address}`;
          const subtitle = `${fmtWindow(it.window_start, it.window_end)} • ${statusLabelCourier(it.status)} • ${
            it.type === "package" ? "חבילה" : "טרמפ"
          }`;
          return (
            <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
              <ListCard title={title} subtitle={subtitle} tone="primary" />
            </View>
          );
        }
      }

      if (roleKey === "rider") {
        const it = item as RiderRequestRow;
        const title = `${it.from_address} → ${it.to_address}`;
        const subtitle = `${fmtWindow(it.window_start, it.window_end)} • ${statusLabelRider(it.status)} • טרמפ`;
        return (
          <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
            <ListCard title={title} subtitle={subtitle} tone="primary" />
          </View>
        );
      }

      // sender
      const it = item as RequestRow;
      const title = `${it.from_address} → ${it.to_address}`;
      const subtitle = `${fmtWindow(it.window_start, it.window_end)} • ${statusLabelSender(it.status)} • ${
        it.type === "package" ? "חבילה" : "טרמפ"
      }`;
      return (
        <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          <ListCard title={title} subtitle={subtitle} tone="primary" />
        </View>
      );
    },
    [roleKey, bucketKey]
  );

  return (
    <View style={S.screen}>
      <Text style={S.header}>{screenTitle}</Text>
      <FlatList
        data={items}
        keyExtractor={(it: any) => it.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        renderItem={renderItem}
        ListEmptyComponent={
          <Text style={S.empty}>{loading ? "טוען…" : "אין פריטים להצגה"}</Text>
        }
        contentContainerStyle={{ paddingBottom: 12 }}
      />
    </View>
  );
}

/* ---------------- helpers (shared) ---------------- */

// Sender statuses
function statusLabelSender(s: RequestRow["status"]) {
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

// Rider statuses
function statusLabelRider(s: RiderRequestRow["status"]) {
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

// Courier statuses
function statusLabelCourier(s: CourierJobRow["status"]) {
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

/* ---------------- styles ---------------- */
const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.primaryDark,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    textAlign: "left",
  },
  empty: {
    textAlign: "center",
    color: COLORS.dim,
    marginTop: 18,
  },
});
