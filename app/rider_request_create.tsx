// app/rider_request_create.tsx
// Create Ride Request (Rider) — same design as sender:
// - Soft-mocha cards, stepbar, bottom sticky CTA
// - One bottom-sheet modal with calendar + time (JS-only)
// - Fields: from/to, window, seats, notes, max price
// - Saves to /requests with type: "passenger"

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
import { createSenderRequest, type CreateRequestInput } from "../lib/api";

dayjs.locale("he");

function fmt(dt?: Date | null) {
  if (!dt) return "";
  return dayjs(dt).format("DD.MM.YYYY HH:mm");
}

export default function RiderRequestCreate() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();

  // form
  const [fromAddress, setFromAddress] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [startDT, setStartDT] = useState<Date | null>(null);
  const [endDT, setEndDT] = useState<Date | null>(null);
  const [seats, setSeats] = useState<string>("1");
  const [notes, setNotes] = useState("");
  const [maxPrice, setMaxPrice] = useState<string>("");

  // date modal
  const [dtModalOpen, setDtModalOpen] = useState(false);
  const [dtTarget, setDtTarget] = useState<"start" | "end">("start");
  const [tempDT, setTempDT] = useState<Date>(new Date());

  const [submitting, setSubmitting] = useState(false);

  const seatsNum = Math.max(1, Number.isFinite(+seats) ? +seats : 0);
  const ready =
    fromAddress.trim().length > 0 &&
    toAddress.trim().length > 0 &&
    !!startDT &&
    !!endDT &&
    seatsNum >= 1 &&
    Number(maxPrice) > 0;

  function openDT(target: "start" | "end") {
    setDtTarget(target);
    setTempDT((target === "start" ? startDT : endDT) || new Date());
    setDtModalOpen(true);
  }
  function confirmDT() {
    if (dtTarget === "start") setStartDT(new Date(tempDT));
    else setEndDT(new Date(tempDT));
    setDtModalOpen(false);
  }

  async function submit() {
    if (!token) {
      Alert.alert("שגיאה", "אסימון התחברות חסר");
      return;
    }
    if (!ready) {
      Alert.alert("שימי לב", "מלאי את כל השדות החיוניים לפני פרסום הבקשה");
      return;
    }
    try {
      setSubmitting(true);
      const payload: CreateRequestInput = {
        type: "passenger",
        from_address: fromAddress.trim(),
        to_address: toAddress.trim(),
        window_start: startDT!.toISOString(),
        window_end: endDT!.toISOString(),
        notes: notes.trim() || undefined,
        max_price: Number(maxPrice),
        passengers: seatsNum,
      };
      await createSenderRequest(String(token), payload);
      Alert.alert("בוצע", "בקשת הטרמפ נשמרה ופורסמה בהצלחה");
      router.replace({ pathname: "/rider_home_page", params: { token } });
    } catch (e: any) {
      Alert.alert("שגיאה", e?.message || "יצירת בקשת טרמפ נכשלה");
    } finally {
      setSubmitting(false);
    }
  }

  // step states
  const step1Done = !!(fromAddress.trim() && toAddress.trim());
  const step2Done = !!(startDT && endDT);
  const step3Done = Number(maxPrice) > 0 && seatsNum >= 1;

  // datepicker styles (highlight selected day immediately)
  const dpBase = useDefaultStyles();
  const dpStyles = {
    ...dpBase,
    selected: { backgroundColor: COLORS.primary, borderRadius: 8 },
    selected_label: { color: "#fff", fontWeight: "900" },
    today: { borderColor: COLORS.primary, borderWidth: 1, borderRadius: 8 },
  } as const;

  return (
    <View style={S.screen}>
      <Header
        title="בקשת טרמפ חדשה"
        subtitle="פרטי נסיעה • זמנים וכתובות • תקציב ואישור"
      />

      {/* step bar */}
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
        {/* addresses */}
        <View style={S.card}>
          <Text style={S.cardTitle}>כתובות</Text>
          <View style={S.field}>
            <Text style={S.label}>נקודת יציאה *</Text>
            <TextInput
              style={S.input}
              placeholder="לדוגמה: בן גוריון 10, תל אביב"
              value={fromAddress}
              onChangeText={setFromAddress}
              textAlign="right"
            />
          </View>
          <View style={S.field}>
            <Text style={S.label}>יעד *</Text>
            <TextInput
              style={S.input}
              placeholder="לדוגמה: הרצל 5, ראשון לציון"
              value={toAddress}
              onChangeText={setToAddress}
              textAlign="right"
            />
          </View>
        </View>

        {/* window */}
        <View style={S.card}>
          <Text style={S.cardTitle}>חלון זמן</Text>
          <View style={S.row2}>
            <TouchableOpacity
              style={S.pickerBtn}
              onPress={() => openDT("start")}
            >
              <Text style={S.pickerLabel}>התחלה *</Text>
              <Text style={S.pickerValue}>
                {startDT ? fmt(startDT) : "בחרי תאריך ושעה"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.pickerBtn} onPress={() => openDT("end")}>
              <Text style={S.pickerLabel}>סיום *</Text>
              <Text style={S.pickerValue}>
                {endDT ? fmt(endDT) : "בחרי תאריך ושעה"}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={S.hint}>טיפ: חלון רחב מגדיל סיכוי להתאמה מהירה.</Text>
        </View>

        {/* seats */}
        <View style={S.card}>
          <Text style={S.cardTitle}>נוסעים</Text>
          <View style={S.field}>
            <Text style={S.label}>מספר נוסעים *</Text>
            <TextInput
              style={S.input}
              placeholder="1"
              keyboardType="numeric"
              value={seats}
              onChangeText={setSeats}
              textAlign="right"
            />
            <Text style={S.hint}>מינימום 1. הזיני את מספר המקומות הנדרש.</Text>
          </View>
        </View>

        {/* notes */}
        <View style={S.card}>
          <Text style={S.cardTitle}>פרטים נוספים</Text>
          <View style={S.field}>
            <Text style={S.label}>הערות (אופציונלי)</Text>
            <TextInput
              style={[S.input, { height: 100, textAlignVertical: "top" }]}
              placeholder="עם כלב / ציוד / העדפות מיוחדות..."
              multiline
              value={notes}
              onChangeText={setNotes}
              textAlign="right"
            />
          </View>
        </View>

        {/* budget */}
        <View style={S.card}>
          <Text style={S.cardTitle}>תקציב</Text>
          <View style={S.field}>
            <Text style={S.label}>תקציב מקסימלי (₪) *</Text>
            <TextInput
              style={S.input}
              placeholder="לדוגמה: 40"
              keyboardType="numeric"
              value={maxPrice}
              onChangeText={setMaxPrice}
              textAlign="right"
            />
            <Text style={S.hint}>
              זהו הסכום המקסימלי שאת/ה מוכנ/ה לשלם על הטרמפ.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* CTA */}
      <TouchableOpacity
        style={[S.bottomBar, !ready || submitting ? { opacity: 0.6 } : null]}
        activeOpacity={0.9}
        onPress={submit}
        disabled={!ready || submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={S.bottomBarText}>פרסום בקשה</Text>
        )}
      </TouchableOpacity>

      {/* date modal */}
      <Modal
        isVisible={dtModalOpen}
        onBackdropPress={() => setDtModalOpen(false)}
        onBackButtonPress={() => setDtModalOpen(false)}
        style={{ justifyContent: "flex-end", margin: 0 }}
      >
        <View style={S.modalSheet}>
          <Text style={S.modalTitle}>
            {dtTarget === "start"
              ? "בחרי תאריך ושעה - התחלה"
              : "בחרי תאריך ושעה - סיום"}
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
              onPress={() => setDtModalOpen(false)}
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

  // Stepbar (RTL)
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

  // Cards — soft mocha
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

  // Pickers
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

  // Modal sheet
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
  modalRow: { flexDirection: "row-reverse", gap: 12, marginTop: 8 },
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
