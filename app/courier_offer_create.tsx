// app/courier_offer_create.tsx

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
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Modal from "react-native-modal";
import UIDatePicker, { useDefaultStyles } from "react-native-ui-datepicker";
import dayjs from "dayjs";
import "dayjs/locale/he";

import { Header } from "./components/Primitives";
import { COLORS } from "./ui/theme";
import { createCourierOffer } from "../lib/api";

dayjs.locale("he");

function fmt(dt?: Date | null) {
  if (!dt) return "";
  return dayjs(dt).format("DD.MM.YYYY HH:mm");
}

export default function CourierOfferCreate() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [fromAddress, setFromAddress] = useState("");
  const [toAddress, setToAddress] = useState<string>("");
  const [anyDestination, setAnyDestination] = useState(false);

  const [startDT, setStartDT] = useState<Date | null>(null);
  const [endDT, setEndDT] = useState<Date | null>(null);

  const [minPrice, setMinPrice] = useState<string>("");
  const [types, setTypes] = useState<("package" | "passenger")[]>(["package"]);
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);

  // Date modal
  const [dtOpen, setDtOpen] = useState(false);
  const [dtTarget, setDtTarget] = useState<"start" | "end">("start");
  const [tempDT, setTempDT] = useState<Date>(new Date());

  const ready =
    fromAddress.trim().length > 0 &&
    (!!anyDestination || toAddress.trim().length > 0) &&
    !!startDT &&
    !!endDT &&
    Number(minPrice) > 0 &&
    types.length > 0;

  function toggleType(t: "package" | "passenger") {
    setTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  }

  function openDT(target: "start" | "end") {
    setDtTarget(target);
    setTempDT((target === "start" ? startDT : endDT) || new Date());
    setDtOpen(true);
  }
  function confirmDT() {
    if (dtTarget === "start") setStartDT(new Date(tempDT));
    else setEndDT(new Date(tempDT));
    setDtOpen(false);
  }

  async function submit() {
    if (!token) {
      Alert.alert("שגיאה", "אסימון התחברות חסר");
      return;
    }
    if (!ready) {
      Alert.alert("שימי לב", "מלאי את כל השדות החיוניים לפני פרסום ההצעה");
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
      await createCourierOffer(String(token), payload);
      Alert.alert("בוצע", "הצעת השליח פורסמה בהצלחה");
      router.replace({ pathname: "/courier_home_page", params: { token } });
    } catch (e: any) {
      Alert.alert("שגיאה", e?.message || "יצירת הצעת שליח נכשלה");
    } finally {
      setSubmitting(false);
    }
  }

  // DatePicker highlight כמו במסכים האחרים
  const dpBase = useDefaultStyles();
  const dpStyles = {
    ...dpBase,
    selected: { backgroundColor: COLORS.primary, borderRadius: 8 },
    selected_label: { color: "#fff", fontWeight: "900" },
    today: { borderColor: COLORS.primary, borderWidth: 1, borderRadius: 8 },
  } as const;

  // Stepbar states
  const step1Done = !!fromAddress && (anyDestination || !!toAddress);
  const step2Done = !!(startDT && endDT);
  const step3Done = Number(minPrice) > 0 && types.length > 0;

  return (
    <View style={S.screen}>
      <Header
        title="הצעת שליח חדשה"
        subtitle="אזור וזמן • סוגי משימות • מחיר מינימלי"
      />

      {/* Stepbar */}
      <View style={S.stepbar}>
        {[
          { label: "פרטים", done: step1Done },
          { label: "זמנים", done: step2Done },
          { label: "אישור", done: step3Done },
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
                  (i === 0 ? step1Done : step2Done) && S.stepDividerDone,
                ]}
              />
            )}
          </View>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
        {/* Addresses */}
        <View style={S.card}>
          <Text style={S.cardTitle}>כתובות</Text>
          <View style={S.field}>
            <Text style={S.label}>נקודת מוצא *</Text>
            <TextInput
              style={S.input}
              placeholder="לדוגמה: דרך השלום 10, תל אביב"
              value={fromAddress}
              onChangeText={setFromAddress}
              textAlign="right"
            />
          </View>

          <View style={[S.row2, { marginBottom: 8 }]}>
            <TouchableOpacity
              style={[S.segmentBtn, anyDestination && S.segmentBtnActive]}
              onPress={() => setAnyDestination(true)}
              activeOpacity={0.8}
            >
              <Text
                style={[S.segmentTxt, anyDestination && S.segmentTxtActive]}
              >
                פתוח לכל יעד
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.segmentBtn, !anyDestination && S.segmentBtnActive]}
              onPress={() => setAnyDestination(false)}
              activeOpacity={0.8}
            >
              <Text
                style={[S.segmentTxt, !anyDestination && S.segmentTxtActive]}
              >
                יעד ספציפי
              </Text>
            </TouchableOpacity>
          </View>

          {!anyDestination && (
            <View style={S.field}>
              <Text style={S.label}>יעד *</Text>
              <TextInput
                style={S.input}
                placeholder="לדוגמה: חיפה, אזור הצפון"
                value={toAddress}
                onChangeText={setToAddress}
                textAlign="right"
              />
            </View>
          )}
        </View>

        {/* Window */}
        <View style={S.card}>
          <Text style={S.cardTitle}>חלון זמן</Text>
          <View style={S.row2}>
            <TouchableOpacity
              style={S.pickerBtn}
              onPress={() => openDT("start")}
            >
              <Text style={S.pickerLabel}>התחלה *</Text>
              <Text style={S.pickerValue}>
                {startDT ? fmt(startDT) : "בחרו תאריך ושעה"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.pickerBtn} onPress={() => openDT("end")}>
              <Text style={S.pickerLabel}>סיום *</Text>
              <Text style={S.pickerValue}>
                {endDT ? fmt(endDT) : "בחרו תאריך ושעה"}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={S.hint}>
            טיפ: חלון רחב מגדיל התאמות עם בקשות פתוחות.
          </Text>
        </View>

        {/* Types & price */}
        <View style={S.card}>
          <Text style={S.cardTitle}>סוגי משימות ומחיר</Text>

          <Text style={S.label}>אני מעוניין לבצע *</Text>
          <View style={[S.row2, { marginTop: 8 }]}>
            <TouchableOpacity
              style={[
                S.segmentBtn,
                types.includes("package") && S.segmentBtnActive,
              ]}
              onPress={() => toggleType("package")}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  S.segmentTxt,
                  types.includes("package") && S.segmentTxtActive,
                ]}
              >
                חבילות
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                S.segmentBtn,
                types.includes("passenger") && S.segmentBtnActive,
              ]}
              onPress={() => toggleType("passenger")}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  S.segmentTxt,
                  types.includes("passenger") && S.segmentTxtActive,
                ]}
              >
                טרמפיסטים
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[S.field, { marginTop: 10 }]}>
            <Text style={S.label}>מחיר מינימלי (₪) *</Text>
            <TextInput
              style={S.input}
              placeholder="לדוגמה: 30"
              keyboardType="numeric"
              value={minPrice}
              onChangeText={setMinPrice}
              textAlign="right"
            />
            <Text style={S.hint}>זהו המחיר המינימלי לנסיעה/משלוח.</Text>
          </View>
        </View>

        {/* Notes (optional) */}
        <View style={S.card}>
          <Text style={S.cardTitle}>הערות (אופציונלי)</Text>
          <View style={S.field}>
            <TextInput
              style={[S.input, { height: 100, textAlignVertical: "top" }]}
              placeholder="פרטים רלוונטיים (ציוד, זמנים, העדפות...)"
              value={notes}
              onChangeText={setNotes}
              multiline
              textAlign="right"
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
          <Text style={S.bottomBarText}>פרסום הצעת שליח</Text>
        )}
      </TouchableOpacity>

      {/* Date modal */}
      <Modal
        isVisible={dtOpen}
        onBackdropPress={() => setDtOpen(false)}
        onBackButtonPress={() => setDtOpen(false)}
        style={{ justifyContent: "flex-end", margin: 0 }}
      >
        <View style={S.modalSheet}>
          <Text style={S.modalTitle}>
            {dtTarget === "start"
              ? "בחרו תאריך ושעה - התחלה"
              : "בחרו תאריך ושעה - סיום"}
          </Text>
          <UIDatePicker
            mode="single"
            date={tempDT}
            onChange={(p: any) => p?.date && setTempDT(p.date)}
            timePicker
            locale="he"
            firstDayOfWeek={0}
            navigationPosition="around"
            styles={dpStyles}
          />
          <View style={S.modalRow}>
            <TouchableOpacity
              style={[S.modalBtn, S.modalCancel]}
              onPress={() => setDtOpen(false)}
            >
              <Text style={[S.modalBtnTxt, S.modalCancelTxt]}>ביטול</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.modalBtn, S.modalConfirm]}
              onPress={confirmDT}
            >
              <Text style={[S.modalBtnTxt, S.modalConfirmTxt]}>אישור</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg, padding: 16 },

  // Stepbar
  stepbar: {
    flexDirection: "row",
    alignItems: "center",
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

  // Cards
  card: {
    backgroundColor: COLORS.softMocha,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E7D8CF",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardTitle: {
    fontWeight: "900",
    color: COLORS.primaryDark,
    marginBottom: 8,
    textAlign: "left",
  },

  // Fields
  field: { marginBottom: 10 },
  label: { fontWeight: "800", color: COLORS.text, textAlign: "left" },
  input: {
    marginTop: 6,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    paddingVertical: 12,
    paddingHorizontal: 12,
    color: COLORS.text,
  },
  hint: { marginTop: 6, color: COLORS.dim, textAlign: "left" },

  // Rows / buttons
  row2: { flexDirection: "row-reverse", gap: 10 },
  pickerBtn: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  pickerLabel: { color: COLORS.dim, fontWeight: "700", textAlign: "left" },
  pickerValue: {
    marginTop: 4,
    fontWeight: "900",
    color: COLORS.text,
    textAlign: "left",
  },

  // Segments
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  segmentBtnActive: { backgroundColor: COLORS.primary },
  segmentTxt: { color: COLORS.primaryDark, fontWeight: "800" },
  segmentTxtActive: { color: "#fff" },

  // Bottom CTA
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

  // Modal
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
