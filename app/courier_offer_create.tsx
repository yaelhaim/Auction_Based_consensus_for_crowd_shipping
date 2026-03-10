// app/courier_offer_create.tsx
// Courier - Create Availability Offer (EN + LTR)
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
import { createCourierOffer } from "../lib/api";

dayjs.locale("en");

const fmt = (d?: Date | null) => (d ? dayjs(d).format("DD.MM.YYYY HH:mm") : "");

export default function CourierOfferCreate() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();

  // Form
  const [fromAddress, setFromAddress] = useState("");
  const [toAddress, setToAddress] = useState<string>("");
  const [anyDestination, setAnyDestination] = useState(false);

  const [startDT, setStartDT] = useState<Date | null>(null);
  const [endDT, setEndDT] = useState<Date | null>(null);

  const [minPrice, setMinPrice] = useState<string>("");
  const [types, setTypes] = useState<("package" | "passenger")[]>(["package"]);
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);

  // Date/time modal
  const [dtOpen, setDtOpen] = useState(false);
  const [dtTarget, setDtTarget] = useState<"start" | "end">("start");
  const [tempDT, setTempDT] = useState<Date>(new Date());

  const ready =
    !!fromAddress.trim() &&
    (!!anyDestination || !!toAddress.trim()) &&
    !!startDT &&
    !!endDT &&
    Number(minPrice) > 0 &&
    types.length > 0;

  function toggleType(t: "package" | "passenger") {
    setTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  function openDate(target: "start" | "end") {
    setDtTarget(target);
    setTempDT((target === "start" ? startDT : endDT) || new Date());
    setDtOpen(true);
  }

  function confirmDate() {
    if (dtTarget === "start") setStartDT(new Date(tempDT));
    else setEndDT(new Date(tempDT));
    setDtOpen(false);
  }

  async function submit() {
    if (!token) {
      Alert.alert("Error", "Missing login token.");
      return;
    }
    if (!ready) {
      Alert.alert(
        "Attention",
        "Please fill in all required fields before publishing the offer.",
      );
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        from_address: fromAddress.trim(),
        to_address: anyDestination ? null : toAddress.trim(),
        window_start: startDT!.toISOString(),
        window_end: endDT!.toISOString(),
        min_price: Number(minPrice),
        types,
        notes: notes.trim() || undefined,
      };

      const { id: createdOfferId } = await createCourierOffer(
        String(token),
        payload,
      );

      Alert.alert("Success", "Your courier offer was published.");
      router.replace({
        pathname: "/matching-await-driver",
        params: { offerId: createdOfferId, token },
      });
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to create courier offer.");
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

  // Steps
  const step1 = !!fromAddress.trim() && (anyDestination || !!toAddress.trim());
  const step2 = !!(startDT && endDT);
  const step3 = Number(minPrice) > 0 && types.length > 0;

  return (
    <LinearGradient
      colors={[COLORS.green1, COLORS.green2, COLORS.green3, COLORS.green4]}
      start={{ x: 1, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={S.safe}>
        <Header
          title="New Courier Offer"
          subtitle="Area & time • Task types • Minimum price"
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

        <ScrollView contentContainerStyle={{ paddingBottom: 180 }}>
          {/* Addresses */}
          <View style={S.card}>
            <Text style={S.cardTitle}>Addresses</Text>

            <View style={S.field}>
              <Text style={S.label}>Starting point *</Text>
              <TextInput
                style={S.input}
                placeholder="e.g., 10 HaShalom Rd, Tel Aviv"
                value={fromAddress}
                onChangeText={setFromAddress}
                textAlign="left"
              />
            </View>

            {/* Destination mode (FIXED: proper segmented control) */}
            <View style={S.segment}>
              <TouchableOpacity
                style={[S.segmentBtn, anyDestination && S.segmentBtnActive]}
                onPress={() => setAnyDestination(true)}
                activeOpacity={0.85}
              >
                <Text
                  style={[S.segmentTxt, anyDestination && S.segmentTxtActive]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  Open to any destination
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[S.segmentBtn, !anyDestination && S.segmentBtnActive]}
                onPress={() => setAnyDestination(false)}
                activeOpacity={0.85}
              >
                <Text
                  style={[S.segmentTxt, !anyDestination && S.segmentTxtActive]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  Specific destination
                </Text>
              </TouchableOpacity>
            </View>

            {!anyDestination && (
              <View style={S.field}>
                <Text style={S.label}>Destination *</Text>
                <TextInput
                  style={S.input}
                  placeholder="e.g., Haifa (North area)"
                  value={toAddress}
                  onChangeText={setToAddress}
                  textAlign="left"
                />
              </View>
            )}
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
              Tip: A wider time window increases matching opportunities.
            </Text>
          </View>

          {/* Task types & price */}
          <View style={S.card}>
            <Text style={S.cardTitle}>Task types & price</Text>

            <Text style={S.label}>I’m available for *</Text>

            <View style={[S.row2, { marginTop: 10 }]}>
              <TouchableOpacity
                style={[
                  S.pillBtn,
                  types.includes("package") && S.pillBtnActive,
                ]}
                onPress={() => toggleType("package")}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    S.pillTxt,
                    types.includes("package") && S.pillTxtActive,
                  ]}
                  numberOfLines={1}
                >
                  Packages
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  S.pillBtn,
                  types.includes("passenger") && S.pillBtnActive,
                ]}
                onPress={() => toggleType("passenger")}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    S.pillTxt,
                    types.includes("passenger") && S.pillTxtActive,
                  ]}
                  numberOfLines={1}
                >
                  Riders
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[S.field, { marginTop: 12 }]}>
              <Text style={S.label}>Minimum price (₪) *</Text>
              <TextInput
                style={S.input}
                placeholder="e.g., 30"
                keyboardType="numeric"
                value={minPrice}
                onChangeText={setMinPrice}
                textAlign="left"
              />
              <Text style={S.hint}>
                This is the minimum amount you’re willing to accept.
              </Text>
            </View>
          </View>

          {/* Notes */}
          <View style={S.card}>
            <Text style={S.cardTitle}>Notes (optional)</Text>
            <View style={S.field}>
              <TextInput
                style={[S.input, { height: 100, textAlignVertical: "top" }]}
                placeholder="Relevant details (equipment, preferences, timing...)"
                value={notes}
                onChangeText={setNotes}
                multiline
                textAlign="left"
              />
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
            <Text style={S.bottomBarText}>Publish Offer</Text>
          )}
        </TouchableOpacity>

        {/* Date/Time modal */}
        <Modal
          isVisible={dtOpen}
          onBackdropPress={() => setDtOpen(false)}
          onBackButtonPress={() => setDtOpen(false)}
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
                onPress={() => setDtOpen(false)}
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

  // --- Row of 2 (LTR) ---
  row2: { flexDirection: "row", gap: 10 },

  // --- Time picker buttons ---
  pickerBtn: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  pickerLabel: {
    color: COLORS.dim,
    fontWeight: "700",
    textAlign: "left",
    writingDirection: "ltr",
  },
  pickerValue: {
    marginTop: 4,
    fontWeight: "900",
    color: COLORS.text,
    textAlign: "left",
    writingDirection: "ltr",
  },

  // --- Destination segmented control (FIX) ---
  segment: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
    overflow: "hidden",
    marginBottom: 10,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnActive: { backgroundColor: COLORS.primary },
  segmentTxt: {
    color: COLORS.primaryDark,
    fontWeight: "800",
    textAlign: "center",
    writingDirection: "ltr",
  },
  segmentTxtActive: { color: "#fff" },

  // --- Task types pills (clean, consistent) ---
  pillBtn: {
    flex: 1,
    minHeight: 44,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  pillBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  pillTxt: {
    color: COLORS.primaryDark,
    fontWeight: "800",
    textAlign: "center",
    writingDirection: "ltr",
  },
  pillTxtActive: { color: "#fff" },

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
