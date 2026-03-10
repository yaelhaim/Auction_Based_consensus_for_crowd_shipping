// app/payment_details.tsx
// Payment summary screen with green gradient background (same vibe as home screens).

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
import { LinearGradient } from "expo-linear-gradient";

import { getAssignmentById, type AssignmentDetailOut } from "../lib/api";

const GREEN_1 = "#DDECCB";
const GREEN_2 = "#CBE1B4";
const GREEN_3 = "#BFD8A0";
const GREEN_4 = "#9BAC70";

const TXT = "#0b0b0b";
const BROWN = "#AF947E";
const CARD_BG = "rgba(255,255,255,0.94)";
const CARD_BORDER = "rgba(0,0,0,0.06)";

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
    null,
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!assignmentId)
          throw new Error("Missing assignment id (assignmentId).");
        const data = await getAssignmentById(String(assignmentId));
        if (cancelled) return;
        setAssignment(data);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "Failed to load payment details.");
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
    router.replace({
      pathname: "/home_page",
      params: { token },
    });
  };

  if (loading) {
    return (
      <LinearGradient
        colors={[GREEN_1, GREEN_2, GREEN_3, GREEN_4]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={S.gradient}
      >
        <View style={S.center}>
          <ActivityIndicator />
          <Text style={S.sub}>Loading payment details…</Text>
        </View>
      </LinearGradient>
    );
  }

  if (error || !assignment) {
    return (
      <LinearGradient
        colors={[GREEN_1, GREEN_2, GREEN_3, GREEN_4]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={S.gradient}
      >
        <View style={S.center}>
          <Text style={S.err}>{error || "No payment data found."}</Text>
          <TouchableOpacity onPress={handleDone} style={[S.btn, S.btnBrown]}>
            <Text style={S.btnText}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  const req = (assignment as any).request as {
    from_address?: string | null;
    to_address?: string | null;
  };

  // ✅ IMPORTANT: your backend data appears swapped, so we flip for display.
  const displayFrom = req?.to_address || "—"; // source (left)
  const displayTo = req?.from_address || "—"; // destination (right)

  const priceCents =
    typeof assignment.agreed_price_cents === "number"
      ? assignment.agreed_price_cents
      : null;

  const priceLabel =
    priceCents != null ? `₪ ${(priceCents / 100).toFixed(2)}` : "—";

  const paymentStatusLabel = prettyPaymentStatus(assignment.payment_status);
  const driverName = assignment.driver?.full_name || "Unnamed driver";

  return (
    <LinearGradient
      colors={[GREEN_1, GREEN_2, GREEN_3, GREEN_4]}
      start={{ x: 1, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={S.gradient}
    >
      {/* ✅ layout that keeps the button up (not too low) */}
      <View style={S.page}>
        <View>
          <View style={S.header}>
            <View style={S.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={S.title}>Payment Details</Text>
                <Text style={S.subtitle}>
                  Your deposit is reserved in the system for this assignment.
                </Text>
              </View>

              <View style={S.iconCircle}>
                <Ionicons name="card" size={22} color="#fff" />
              </View>
            </View>

            <View style={S.badgeRow}>
              <Ionicons name="shield-checkmark" size={16} color="#fff" />
              <Text style={S.badgeText}>
                No immediate charge — logical escrow only
              </Text>
            </View>
          </View>

          {/* Amount card */}
          <View style={S.card}>
            <Text style={S.sectionTitle}>Agreed Payment Amount</Text>
            <Text style={S.amount}>{priceLabel}</Text>

            <View style={S.kvRow}>
              <Text style={S.kvLabel}>Payment status</Text>
              <Text style={S.kvValue}>{paymentStatusLabel}</Text>
            </View>

            {!!escrowId && (
              <View style={S.kvRow}>
                <Text style={S.kvLabel}>Escrow ID</Text>
                <Text style={S.kvValueSmall} numberOfLines={1}>
                  {escrowId}
                </Text>
              </View>
            )}
          </View>

          {/* Assignment details card */}
          <View style={S.card}>
            <Text style={S.sectionTitle}>Assignment Info</Text>

            <View style={S.kvRow}>
              <Text style={S.kvLabel}>Driver</Text>
              <Text style={S.kvValue}>{driverName}</Text>
            </View>

            {/* ✅ LTR route: SOURCE (left) -> DEST (right) */}
            <View style={S.routePill}>
              <Text
                style={[S.routeText, { textAlign: "left" }]}
                numberOfLines={1}
              >
                {displayFrom}
              </Text>

              <Ionicons
                name="arrow-forward"
                size={18}
                color="#6b7280"
                style={{ marginHorizontal: 10 }}
              />

              <Text
                style={[S.routeText, { textAlign: "right" }]}
                numberOfLines={1}
              >
                {displayTo}
              </Text>
            </View>
          </View>

          {/* Explanation card */}
          <View style={S.card}>
            <Text style={S.sectionTitle}>What happens next?</Text>

            <Text style={S.body}>
              At this stage, no credit-card charge is made. The system only
              creates a logical escrow on the blockchain that represents a
              commitment to pay the driver when the delivery is completed.
            </Text>

            <Text style={S.body}>
              After the delivery is marked as completed and you confirm the
              handoff, the escrow is marked as ready to be released to the
              driver (based on the settlement mechanism defined outside the
              app).
            </Text>
          </View>
        </View>

        {/* Footer button */}
        <View style={S.footer}>
          <TouchableOpacity onPress={handleDone} style={[S.btn, S.btnBrown]}>
            <Text style={S.btnText}>Got it — continue</Text>
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
  );
}

function prettyPaymentStatus(s?: string | null) {
  if (!s) return "Not available";
  switch (s) {
    case "pending_deposit":
      return "Awaiting deposit";
    case "deposited":
      return "Deposit received";
    case "released":
      return "Payment released";
    case "refunded":
      return "Refunded";
    case "failed":
      return "Payment failed";
    case "cancelled":
      return "Cancelled";
    default:
      return s.replaceAll("_", " ");
  }
}

const S = StyleSheet.create({
  gradient: { flex: 1 },

  // ✅ keep footer button from dropping too low
  page: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 22,
    justifyContent: "space-between",
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  sub: { fontSize: 14, color: "#374151" },
  err: { fontSize: 14, color: "#b91c1c", textAlign: "center" },

  header: { marginBottom: 12 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },

  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: BROWN,
    alignItems: "center",
    justifyContent: "center",
  },

  title: {
    fontSize: 22,
    fontWeight: "900",
    color: TXT,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13,
    color: "#374151",
    marginTop: 2,
    textAlign: "center",
    lineHeight: 18,
  },

  badgeRow: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.25)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  card: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    padding: 14,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },

  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: TXT,
    marginBottom: 8,
    textAlign: "center",
  },

  amount: {
    fontSize: 30,
    fontWeight: "900",
    color: TXT,
    marginBottom: 12,
    textAlign: "left",
  },

  kvRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 6,
  },
  kvLabel: {
    fontSize: 13,
    color: "#6b7280",
    flexShrink: 0,
  },
  kvValue: {
    fontSize: 14,
    color: TXT,
    fontWeight: "800",
    textAlign: "right",
    flex: 1,
  },
  kvValueSmall: {
    fontSize: 11,
    color: TXT,
    fontWeight: "700",
    textAlign: "right",
    flex: 1,
  },

  body: {
    fontSize: 13,
    color: "#374151",
    lineHeight: 20,
    textAlign: "center",
    marginTop: 6,
  },

  routePill: {
    marginTop: 12,
    alignSelf: "stretch",
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  routeText: {
    color: TXT,
    fontWeight: "700",
    maxWidth: "42%",
  },

  footer: {
    alignItems: "center",
    paddingTop: 10,
  },

  btn: {
    paddingVertical: 12,
    paddingHorizontal: 26,
    borderRadius: 999,
    alignSelf: "center",
  },
  btnBrown: { backgroundColor: BROWN },
  btnText: { color: "#fff", fontWeight: "900", fontSize: 15 },
});
