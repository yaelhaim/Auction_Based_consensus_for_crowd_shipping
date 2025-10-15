// app/sender_request_create.tsx
// Modern "Create Request (Sender)" screen
// - Navigates to /matching-await after successful publish (instead of sender home)
// - Uses pickRequestId() to extract id from API response

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

// Try to extract request id from various response shapes
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

  // Who picks up? default: "other" (forces details)
  const [pickupBy, setPickupBy] = useState<"me" | "other">("other");
  const [pickupName, setPickupName] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");

  // One modal (calendar + time) for start/end
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

      // Send to backend
      const res = await createSenderRequest(String(token), payload);
      const requestId = pickRequestId(res);

      if (!requestId) {
        // Fallback if API didn't return an id
        Alert.alert(
          "בקשה נשמרה",
          "הבקשה נשמרה, אך לא קיבלנו מזהה בקשה להצגת מסך ההמתנה. נחזיר לדף הבית."
        );
        router.replace({ pathname: "/sender_home_page", params: { token } });
        return;
      }

      // Navigate to the waiting screen (defers push + polling there)
      router.replace({
        pathname: "/matching-await",
        params: { requestId, token, role: "sender" },
      });
    } catch (e: any) {
      Alert.alert("שגיאה", e?.message || "יצירת הבקשה נכשלה");
    } finally {
      setSubmitting(false);
    }
  }

  // Step completion
  const step1Done = !!(fromAddress.trim() && toAddress.trim());
  const step2Done = !!(startDT && endDT);
  const step3Done = Number(maxPrice) > 0;

  // DatePicker styles — selected day feedback immediately on tap
  const dpBase = useDefaultStyles();
  const dpStyles = {
    ...dpBase,
    // highlight selected day background + label
    selected: { backgroundColor: COLORS.primary, borderRadius: 8 },
    selected_label: { color: "#fff", fontWeight: "900" },
    // emphasize "today"
    today: { borderColor: COLORS.primary, borderWidth: 1, borderRadius: 8 },
  } as const;

  return (
    <View style={S.screen}>
      <Header
        title="בקשה חדשה"
        subtitle="פרטי משלוח • זמנים וכתובות • תקציב ואישור"
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
        {/* From / To */}
        <View style={S.card}>
          <Text style={S.cardTitle}>כתובות</Text>
          <View style={S.field}>
            <Text style={S.label}>כתובת איסוף *</Text>
            <TextInput
              style={S.input}
              placeholder="לדוגמה: בן גוריון 10, תל אביב"
              value={fromAddress}
              onChangeText={setFromAddress}
              textAlign="right"
            />
          </View>

          <View style={S.field}>
            <Text style={S.label}>כתובת יעד *</Text>
            <TextInput
              style={S.input}
              placeholder="לדוגמה: הרצל 5, ראשון לציון"
              value={toAddress}
              onChangeText={setToAddress}
              textAlign="right"
            />
          </View>
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

          <Text style={S.hint}>טיפ: חלון רחב מגדיל סיכוי לשיבוץ מהיר.</Text>
        </View>

        {/* Notes */}
        <View style={S.card}>
          <Text style={S.cardTitle}>פרטים נוספים</Text>
          <View style={S.field}>
            <Text style={S.label}>הערות (אופציונלי)</Text>
            <TextInput
              style={[S.input, { height: 100, textAlignVertical: "top" }]}
              placeholder="שביר / מסירה עד הדלת / הנחיות מיוחדות..."
              multiline
              value={notes}
              onChangeText={setNotes}
              textAlign="right"
            />
          </View>
        </View>

        {/* Pickup contact — default: OTHER (required) */}
        <View style={S.card}>
          <Text style={S.cardTitle}>מי אוסף את החבילה?</Text>

          {/* Segmented switch */}
          <View style={S.segment}>
            {(["me", "other"] as const).map((opt) => (
              <TouchableOpacity
                key={opt}
                onPress={() => setPickupBy(opt)}
                style={[S.segmentBtn, pickupBy === opt && S.segmentBtnActive]}
                activeOpacity={0.8}
              >
                <Text
                  style={[S.segmentTxt, pickupBy === opt && S.segmentTxtActive]}
                >
                  {opt === "me" ? "אני" : "אדם אחר"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {pickupBy === "other" ? (
            <>
              <View style={S.field}>
                <Text style={S.label}>שם מוסר/ת *</Text>
                <TextInput
                  style={S.input}
                  placeholder="לדוגמה: דנה כהן"
                  value={pickupName}
                  onChangeText={setPickupName}
                  textAlign="right"
                />
              </View>
              <View style={S.field}>
                <Text style={S.label}>נייד מוסר/ת *</Text>
                <TextInput
                  style={S.input}
                  placeholder="050-1234567"
                  keyboardType="phone-pad"
                  value={pickupPhone}
                  onChangeText={setPickupPhone}
                  textAlign="right"
                />
              </View>
            </>
          ) : (
            <Text style={S.hint}>נשתמש בשם והטלפון שלך כברירת מחדל.</Text>
          )}
        </View>

        {/* Budget */}
        <View style={S.card}>
          <Text style={S.cardTitle}>תקציב</Text>
          <View style={S.field}>
            <Text style={S.label}>תקציב מקסימלי (₪) *</Text>
            <TextInput
              style={S.input}
              placeholder="לדוגמה: 75"
              keyboardType="numeric"
              value={maxPrice}
              onChangeText={setMaxPrice}
              textAlign="right"
            />
            <Text style={S.hint}>
              זהו הסכום המקסימלי שאת מוכנה לשלם על המשלוח.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Sticky bottom CTA */}
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

      {/* Bottom sheet: calendar + time together */}
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
  stepbar: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
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
    textAlign: "right",
  },

  // Segment switch
  segment: {
    flexDirection: "row-reverse",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    overflow: "hidden",
    marginBottom: 10,
  },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: "center" },
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
