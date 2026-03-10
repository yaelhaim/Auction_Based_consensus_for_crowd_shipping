// Sender - Create Package Request (EN + LTR)
// Visuals: mocha cards + CTA identical to home button
// Comments in English, UI in English

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Modal from "react-native-modal";
import UIDatePicker, { useDefaultStyles } from "react-native-ui-datepicker";
import { LinearGradient } from "expo-linear-gradient";
import dayjs from "dayjs";
import "dayjs/locale/en";

import { Header } from "./components/Primitives";
import { COLORS } from "./ui/theme";
import { createSenderRequest, type CreateRequestInput } from "../lib/api";

dayjs.locale("en");

function fmt(dt?: Date | null) {
  if (!dt) return "";
  return dayjs(dt).format("DD.MM.YYYY HH:mm");
}

// Try to extract request id from different response shapes
function pickRequestId(res: any): string | null {
  if (!res) return null;
  if (typeof res === "string") return res;
  if (typeof res?.id !== "undefined") return String(res.id);
  if (typeof res?.request_id !== "undefined") return String(res.request_id);
  if (typeof res?.requestId !== "undefined") return String(res.requestId);
  if (typeof res?.data?.id !== "undefined") return String(res.data.id);
  if (typeof res?.data?.request_id !== "undefined")
    return String(res.data.request_id);
  return null;
}

export default function SenderRequestCreate() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();

  // Form state
  const [fromAddress, setFromAddress] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [startDT, setStartDT] = useState<Date | null>(null);
  const [endDT, setEndDT] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  const [maxPrice, setMaxPrice] = useState<string>("");

  // Pickup contact
  const [pickupBy, setPickupBy] = useState<"me" | "other">("other");
  const [pickupName, setPickupName] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");

  // Date/time modal
  const [dtModalOpen, setDtModalOpen] = useState(false);
  const [dtTarget, setDtTarget] = useState<"start" | "end">("start");
  const [tempDT, setTempDT] = useState<Date>(new Date());

  const [submitting, setSubmitting] = useState(false);

  const ready =
    fromAddress.trim().length > 0 &&
    toAddress.trim().length > 0 &&
    !!startDT &&
    !!endDT &&
    Number(maxPrice) > 0 &&
    (pickupBy === "me" ||
      (pickupName.trim().length > 0 && pickupPhone.trim().length > 0));

  function openDate(target: "start" | "end") {
    setDtTarget(target);
    setTempDT((target === "start" ? startDT : endDT) || new Date());
    setDtModalOpen(true);
  }

  function confirmDate() {
    if (dtTarget === "start") setStartDT(new Date(tempDT));
    else setEndDT(new Date(tempDT));
    setDtModalOpen(false);
  }

  async function submit() {
    if (!token) {
      Alert.alert("Error", "Missing login token.");
      return;
    }
    if (!ready) {
      Alert.alert(
        "Attention",
        "Please fill in all required fields before publishing the request.",
      );
      return;
    }

    try {
      setSubmitting(true);

      const payload: CreateRequestInput = {
        type: "package",
        from_address: fromAddress.trim(),
        to_address: toAddress.trim(),
        window_start: startDT!.toISOString(),
        window_end: endDT!.toISOString(),
        notes: notes.trim() || undefined,
        max_price: Number(maxPrice),
        pickup_contact_name:
          pickupBy === "other" ? pickupName.trim() : undefined,
        pickup_contact_phone:
          pickupBy === "other" ? pickupPhone.trim() : undefined,
      };

      const res = await createSenderRequest(String(token), payload);
      const requestId = pickRequestId(res);

      if (!requestId) {
        Alert.alert(
          "Request saved",
          "Your request was saved, but we couldn't fetch its ID to show the waiting screen. Returning to Home.",
        );
        router.replace({ pathname: "/sender_home_page", params: { token } });
        return;
      }

      router.replace({
        pathname: "/matching-await",
        params: { requestId, token, role: "sender" },
      });
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to create the request.");
    } finally {
      setSubmitting(false);
    }
  }

  // Date picker styling
  const dpBase = useDefaultStyles();
  const dpStyles = {
    ...dpBase,
    selected: { backgroundColor: COLORS.primary, borderRadius: 8 },
    selected_label: { color: "#fff", fontWeight: "900" },
    today: { borderColor: COLORS.primary, borderWidth: 1, borderRadius: 8 },
  } as const;

  // Step states
  const step1 = !!(fromAddress.trim() && toAddress.trim());
  const step2 = !!(startDT && endDT);
  const step3 = Number(maxPrice) > 0;

  return (
    <LinearGradient
      colors={[COLORS.green1, COLORS.green2, COLORS.green3, COLORS.green4]}
      start={{ x: 1, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={S.safe}>
        <Header
          title="New Request"
          subtitle="Shipment details • Time window • Budget & confirmation"
        />

        {/* Steps bar */}
        <View style={S.stepbar}>
          {[
            { label: "Details", done: step1 },
            { label: "Time", done: step2 },
            { label: "Confirm", done: step3 },
          ].map((s, i) => (
            <View style={S.stepItem} key={s.label}>
              <View style={[S.stepCircle, s.done && S.stepCircleDone]}>
                <Text style={[S.stepIndex, s.done && S.stepIndexDone]}>
                  {i + 1}
                </Text>
              </View>

              <Text style={S.stepLabel}>{s.label}</Text>

              {i < 2 && (
                <View
                  style={[
                    S.stepDivider,
                    (i === 0 ? step1 : step2) && S.stepDividerDone,
                  ]}
                />
              )}
            </View>
          ))}
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
          {/* Addresses */}
          <View style={S.card}>
            <Text style={S.cardTitle}>Addresses</Text>

            <View style={S.field}>
              <Text style={S.label}>Pickup address *</Text>
              <TextInput
                style={S.input}
                placeholder="e.g., 10 Ben Gurion St, Tel Aviv"
                value={fromAddress}
                onChangeText={setFromAddress}
                textAlign="left"
              />
            </View>

            <View style={S.field}>
              <Text style={S.label}>Destination address *</Text>
              <TextInput
                style={S.input}
                placeholder="e.g., 5 Herzl St, Rishon LeZion"
                value={toAddress}
                onChangeText={setToAddress}
                textAlign="left"
              />
            </View>
          </View>

          {/* Time window */}
          <View style={S.card}>
            <Text style={S.cardTitle}>Time window</Text>

            <View style={S.row2}>
              <TouchableOpacity
                style={S.pickerBtn}
                onPress={() => openDate("start")}
              >
                <Text style={S.pickerLabel}>Start *</Text>
                <Text style={S.pickerValue}>
                  {startDT ? fmt(startDT) : "Select date & time"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={S.pickerBtn}
                onPress={() => openDate("end")}
              >
                <Text style={S.pickerLabel}>End *</Text>
                <Text style={S.pickerValue}>
                  {endDT ? fmt(endDT) : "Select date & time"}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={S.hint}>
              Tip: A wider time window increases the chance of a quick match.
            </Text>
          </View>

          {/* Extra details */}
          <View style={S.card}>
            <Text style={S.cardTitle}>Additional details</Text>

            <View style={S.field}>
              <Text style={S.label}>Notes (optional)</Text>
              <TextInput
                style={[S.input, { height: 100, textAlignVertical: "top" }]}
                placeholder="Fragile / leave at door / special instructions..."
                multiline
                value={notes}
                onChangeText={setNotes}
                textAlign="left"
              />
            </View>
          </View>

          {/* Pickup contact */}
          <View style={S.card}>
            <Text style={S.cardTitle}>Who will hand over the package?</Text>

            <View style={S.segment}>
              {(["me", "other"] as const).map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => setPickupBy(opt)}
                  style={[S.segmentBtn, pickupBy === opt && S.segmentBtnActive]}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      S.segmentTxt,
                      pickupBy === opt && S.segmentTxtActive,
                    ]}
                  >
                    {opt === "me" ? "Me" : "Someone else"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {pickupBy === "other" ? (
              <>
                <View style={S.field}>
                  <Text style={S.label}>Contact name *</Text>
                  <TextInput
                    style={S.input}
                    placeholder="e.g., Dana Cohen"
                    value={pickupName}
                    onChangeText={setPickupName}
                    textAlign="left"
                  />
                </View>

                <View style={S.field}>
                  <Text style={S.label}>Contact phone *</Text>
                  <TextInput
                    style={S.input}
                    placeholder="050-1234567"
                    keyboardType="phone-pad"
                    value={pickupPhone}
                    onChangeText={setPickupPhone}
                    textAlign="left"
                  />
                </View>
              </>
            ) : (
              <Text style={S.hint}>
                We'll use your profile name and phone by default.
              </Text>
            )}
          </View>

          {/* Budget */}
          <View style={S.card}>
            <Text style={S.cardTitle}>Budget</Text>

            <View style={S.field}>
              <Text style={S.label}>Maximum budget (₪) *</Text>
              <TextInput
                style={S.input}
                placeholder="e.g., 75"
                keyboardType="numeric"
                value={maxPrice}
                onChangeText={setMaxPrice}
                textAlign="left"
              />

              <Text style={S.hint}>
                This is the maximum amount you’re willing to pay for the
                delivery.
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Bottom CTA */}
        <TouchableOpacity
          style={[S.bottomBar, !ready || submitting ? { opacity: 0.6 } : null]}
          activeOpacity={0.9}
          onPress={submit}
          disabled={!ready || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={S.bottomBarText}>Publish Request</Text>
          )}
        </TouchableOpacity>

        {/* Date/Time modal */}
        <Modal
          isVisible={dtModalOpen}
          onBackdropPress={() => setDtModalOpen(false)}
          onBackButtonPress={() => setDtModalOpen(false)}
          style={{ justifyContent: "flex-end", margin: 0 }}
        >
          <View style={S.modalSheet}>
            <Text style={S.modalTitle}>
              {dtTarget === "start"
                ? "Select date & time — Start"
                : "Select date & time — End"}
            </Text>

            <UIDatePicker
              mode="single"
              date={tempDT}
              onChange={(p: any) => p?.date && setTempDT(p.date)}
              timePicker
              locale="en"
              firstDayOfWeek={0}
              navigationPosition="around"
              styles={dpStyles}
            />

            <View style={S.modalRow}>
              <TouchableOpacity
                style={[S.modalBtn, S.modalCancel]}
                onPress={() => setDtModalOpen(false)}
              >
                <Text style={[S.modalBtnTxt, S.modalCancelTxt]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[S.modalBtn, S.modalConfirm]}
                onPress={confirmDate}
              >
                <Text style={[S.modalBtnTxt, S.modalConfirmTxt]}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 45 },

  // --- Steps ---
  stepbar: {
    direction: "ltr",
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    marginBottom: 12,
  },
  stepItem: { flexDirection: "row", alignItems: "center", flex: 1 },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  stepCircleDone: { backgroundColor: COLORS.primary },
  stepIndex: { color: COLORS.primary, fontWeight: "900" },
  stepIndexDone: { color: "#fff" },
  stepLabel: { marginHorizontal: 6, color: COLORS.text, fontWeight: "800" },
  stepDivider: {
    flex: 1,
    height: 2,
    backgroundColor: COLORS.border,
    marginHorizontal: 6,
    borderRadius: 2,
  },
  stepDividerDone: { backgroundColor: COLORS.primary },

  // --- Cards ---
  card: {
    backgroundColor: COLORS.softMocha,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 0,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    direction: "ltr",
    alignItems: "stretch",
  },
  cardTitle: {
    fontWeight: "900",
    color: COLORS.primaryDark,
    marginBottom: 8,
    textAlign: "left",
    writingDirection: "ltr",
    alignSelf: "flex-start",
  },

  field: { marginBottom: 10 },
  label: {
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "left",
    writingDirection: "ltr",
    direction: "ltr",
    alignSelf: "flex-start",
  },
  input: {
    marginTop: 6,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
    paddingVertical: 12,
    paddingHorizontal: 12,
    color: COLORS.text,
    textAlign: "left",
    writingDirection: "ltr",
  },
  hint: {
    marginTop: 6,
    color: COLORS.dim,
    textAlign: "left",
    writingDirection: "ltr",
  },

  // --- Time row (LTR) ---
  row2: { flexDirection: "row", gap: 10 },
  pickerBtn: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  pickerLabel: { color: COLORS.dim, fontWeight: "700", textAlign: "left" },
  pickerValue: {
    marginTop: 4,
    fontWeight: "900",
    color: COLORS.text,
    textAlign: "left",
    writingDirection: "ltr",
  },

  // --- Segment (LTR) ---
  segment: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
    overflow: "hidden",
    marginBottom: 10,
  },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: "center" },
  segmentBtnActive: { backgroundColor: COLORS.primary },
  segmentTxt: { color: COLORS.primaryDark, fontWeight: "800" },
  segmentTxtActive: { color: "#fff" },

  // --- Bottom CTA ---
  bottomBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 18,
    height: 54,
    backgroundColor: COLORS.primary,
    borderRadius: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  bottomBarText: { color: "#fff", fontWeight: "900", fontSize: 16 },

  // --- Modal ---
  modalSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
  },
  modalTitle: {
    fontWeight: "900",
    fontSize: 16,
    textAlign: "center",
    color: COLORS.primaryDark,
    marginBottom: 8,
  },
  modalRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  modalBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalCancel: { backgroundColor: "#F3F3F3" },
  modalConfirm: { backgroundColor: COLORS.primary },
  modalBtnTxt: { fontWeight: "900" },
  modalCancelTxt: { color: COLORS.text },
  modalConfirmTxt: { color: "#fff" },
});
