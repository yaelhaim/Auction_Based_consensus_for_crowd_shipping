// app/payment_details.tsx
// Simple payment summary screen.
//
// Flow:
//  - Opened after escrow creation from assignment_details.
//  - Shows agreed price, basic assignment info, and payment status.
//  - Explains that actual money is NOT charged yet (logical escrow only).
//  - Single button to go back to home.

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { getAssignmentById, type AssignmentDetailOut } from "../lib/api";

const BG = "#f7f7f5";
const TXT = "#0b0b0b";
const BROWN = "#CDB8A7";
const CARD_BG = "#ffffff";

type Params = {
  token?: string;
  assignmentId?: string;
  escrowId?: string;
};

export default function PaymentDetails() {
  const router = useRouter();
  const { token, assignmentId, escrowId } = useLocalSearchParams<Params>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDetailOut | null>(
    null
  );

  // Load latest assignment data (price + payment_status + driver/request)
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!assignmentId) {
          throw new Error("חסר מזהה שיוך (assignmentId)");
        }
        const data = await getAssignmentById(String(assignmentId));
        if (cancelled) return;
        setAssignment(data);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "שגיאה בטעינת נתוני התשלום");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  const handleDone = () => {
    // Go back to main home page (you can route per role later if needed)
    router.replace({
      pathname: "/home_page",
      params: { token },
    });
  };

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator />
        <Text style={S.sub}>טוען פרטי תשלום…</Text>
      </View>
    );
  }

  if (error || !assignment) {
    return (
      <View style={S.center}>
        <Text style={S.err}>{error || "לא נמצאו נתונים לתשלום"}</Text>
        <TouchableOpacity onPress={handleDone} style={[S.btn, S.btnBrown]}>
          <Text style={S.btnText}>חזרה למסך הבית</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const req = (assignment as any).request as {
    from_address?: string | null;
    to_address?: string | null;
  };

  const priceCents =
    typeof assignment.agreed_price_cents === "number"
      ? assignment.agreed_price_cents
      : null;
  const priceLabel =
    priceCents != null ? `${(priceCents / 100).toFixed(2)} ₪` : "—";

  const paymentStatusLabel = prettyPaymentStatus(assignment.payment_status);

  const driverName = assignment.driver?.full_name || "נהג ללא שם";

  const fromLabel = req?.from_address || "—";
  const toLabel = req?.to_address || "—";

  return (
    <View style={S.page}>
      <View style={S.header}>
        <Text style={S.title}>פרטי תשלום</Text>
        <Text style={S.subtitle}>
          הפיקדון נוצר בבלוקצ&apos;יין עבור השיוך הנוכחי.
        </Text>
      </View>

      <View style={S.card}>
        <Text style={S.sectionTitle}>סכום התשלום שסוכם</Text>
        <Text style={S.amount}>{priceLabel}</Text>

        <View style={S.row}>
          <Text style={S.label}>סטטוס תשלום:</Text>
          <Text style={S.value}>{paymentStatusLabel}</Text>
        </View>

        {escrowId && (
          <View style={S.row}>
            <Text style={S.label}>מזהה פיקדון:</Text>
            <Text style={S.valueSmall} numberOfLines={1}>
              {escrowId}
            </Text>
          </View>
        )}
      </View>

      <View style={S.card}>
        <Text style={S.sectionTitle}>פרטי השיוך</Text>
        <View style={S.row}>
          <Text style={S.label}>נהג:</Text>
          <Text style={S.value}>{driverName}</Text>
        </View>

        <View style={[S.routePill, { flexDirection: "row" }]}>
          <Text style={[S.routeText, { textAlign: "left" }]} numberOfLines={1}>
            {fromLabel}
          </Text>
          <Ionicons
            name="arrow-forward"
            size={18}
            color="#6b7280"
            style={{ marginHorizontal: 10 }}
          />
          <Text style={[S.routeText, { textAlign: "right" }]} numberOfLines={1}>
            {toLabel}
          </Text>
        </View>
      </View>

      <View style={S.card}>
        <Text style={S.sectionTitle}>מה קורה עכשיו?</Text>
        <Text style={S.body}>
          בשלב זה לא מתבצע חיוב בכרטיס אשראי. המערכת רק שומרת פיקדון לוגי
          בבלוקצ&apos;יין שמייצג התחייבות לתשלום לנהג בסיום המשלוח.
        </Text>
        <Text style={S.body}>
          לאחר שהמשלוח יסומן כמושלם ותאשר/י את המסירה, הפיקדון יסומן כתשלום שיש
          להעביר לנהג (לפי המנגנון שנבחר מחוץ לאפליקציה).
        </Text>
      </View>

      <View style={S.footer}>
        <TouchableOpacity onPress={handleDone} style={[S.btn, S.btnBrown]}>
          <Text style={S.btnText}>אישור, אפשר להמשיך</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ---------------- helpers ---------------- */

function prettyPaymentStatus(s?: string | null) {
  if (!s) return "לא זמין";
  switch (s) {
    case "pending_deposit":
      return "ממתין להפקדת תשלום";
    case "deposited":
      return "תשלום הופקד";
    case "released":
      return "תשלום שוחרר";
    case "refunded":
      return "תשלום הוחזר";
    case "failed":
      return "תשלום נכשל";
    case "cancelled":
      return "תשלום בוטל";
    default:
      return s.replaceAll("_", " ");
  }
}

/* ---------------- styles ---------------- */

const S = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 16,
    paddingTop: 32,
    paddingBottom: 16,
  },
  center: {
    flex: 1,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  sub: { fontSize: 14, color: "#6b7280" },
  err: { fontSize: 14, color: "#b91c1c", textAlign: "center" },

  header: {
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: TXT,
    textAlign: "right",
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 4,
    textAlign: "right",
  },

  card: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: TXT,
    marginBottom: 8,
    textAlign: "right",
  },
  amount: {
    fontSize: 24,
    fontWeight: "800",
    color: TXT,
    marginBottom: 12,
    textAlign: "right",
  },
  row: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  label: {
    fontSize: 14,
    color: "#6b7280",
    marginLeft: 8,
  },
  value: {
    fontSize: 14,
    color: TXT,
    fontWeight: "600",
  },
  valueSmall: {
    fontSize: 12,
    color: TXT,
    flex: 1,
    textAlign: "left",
  },
  body: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
    textAlign: "right",
    marginTop: 4,
  },

  routePill: {
    marginTop: 10,
    alignSelf: "stretch",
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  routeText: {
    color: TXT,
    fontWeight: "600",
    maxWidth: "40%",
  },

  footer: {
    marginTop: 18,
    alignItems: "center",
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignSelf: "center",
  },
  btnBrown: {
    backgroundColor: BROWN,
  },
  btnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 15,
  },
});
