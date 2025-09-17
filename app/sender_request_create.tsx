// Modern "Create Request (Sender)" screen
// - Stepbar
// - Cards with elevation
// - Date/Time pickers (react-native-modal-datetime-picker)
// - Loading state on publish
// - Full RTL friendly

import React, { useMemo, useState } from "react";
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
import DateTimePickerModal from "react-native-modal-datetime-picker";
import { Header } from "./components/Primitives";
import { COLORS } from "./ui/theme";
import { createSenderRequest, type CreateRequestInput } from "../lib/api";

function fmt(dt?: Date | null) {
  if (!dt) return "";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const min = String(dt.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
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

  const [useOtherPickup, setUseOtherPickup] = useState(false);
  const [pickupName, setPickupName] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");

  // Picker modal state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<"start" | "end">("start");
  const [pickerPhase, setPickerPhase] = useState<"date" | "time">("date");
  const [tempDate, setTempDate] = useState<Date>(new Date());

  const [submitting, setSubmitting] = useState(false);

  const ready =
    fromAddress.trim().length > 0 &&
    toAddress.trim().length > 0 &&
    !!startDT &&
    !!endDT &&
    Number(maxPrice) > 0 &&
    (!useOtherPickup ||
      (pickupName.trim().length > 0 && pickupPhone.trim().length > 0));

  // Open picker (date then time)
  function openPicker(target: "start" | "end") {
    setPickerTarget(target);
    setPickerPhase("date");
    setTempDate(
      target === "start" ? startDT || new Date() : endDT || new Date()
    );
    setPickerVisible(true);
  }

  function onConfirmPicker(dt: Date) {
    if (pickerPhase === "date") {
      // Save picked date, continue to time
      const next = new Date(dt);
      const base =
        pickerTarget === "start" ? startDT || new Date() : endDT || new Date();
      next.setHours(base.getHours(), base.getMinutes(), 0, 0);
      setTempDate(next);
      setPickerPhase("time");
      return;
    }
    // phase === 'time' -> finalize
    const picked = new Date(tempDate);
    picked.setHours(dt.getHours(), dt.getMinutes(), 0, 0);
    if (pickerTarget === "start") setStartDT(picked);
    else setEndDT(picked);
    setPickerVisible(false);
  }

  function onCancelPicker() {
    // Cancel entirely (if on time phase, just close)
    setPickerVisible(false);
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
        pickup_contact_name: useOtherPickup ? pickupName.trim() : undefined,
        pickup_contact_phone: useOtherPickup ? pickupPhone.trim() : undefined,
      };
      await createSenderRequest(String(token), payload);
      Alert.alert("בוצע", "הבקשה נשמרה ופורסמה בהצלחה");
      router.replace({ pathname: "/sender_home_page", params: { token } });
    } catch (e: any) {
      Alert.alert("שגיאה", e?.message || "יצירת הבקשה נכשלה");
    } finally {
      setSubmitting(false);
    }
  }

  // Stepbar: step 1 complete when addresses filled, step 2 when dates set, step 3 when price set
  const step1Done = fromAddress.trim() && toAddress.trim();
  const step2Done = !!startDT && !!endDT;
  const step3Done = Number(maxPrice) > 0;

  return (
    <View style={S.screen}>
      <Header
        title="בקשה חדשה"
        subtitle="פרטי משלוח • זמנים וכתובות • תקציב ואישור"
      />

      {/* Stepbar */}
      <View style={S.stepbar}>
        {[
          { label: "פרטים", done: !!step1Done },
          { label: "זמנים", done: !!step2Done },
          { label: "אישור", done: !!step3Done },
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

        {/* Windows */}
        <View style={S.card}>
          <Text style={S.cardTitle}>חלון זמן</Text>

          <View style={S.row2}>
            <TouchableOpacity
              style={S.pickerBtn}
              onPress={() => openPicker("start")}
            >
              <Text style={S.pickerLabel}>התחלה *</Text>
              <Text style={S.pickerValue}>
                {startDT ? fmt(startDT) : "בחרי תאריך ושעה"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={S.pickerBtn}
              onPress={() => openPicker("end")}
            >
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

        {/* Pickup contact */}
        <View style={S.card}>
          <Text style={S.cardTitle}>איש קשר באיסוף</Text>

          <TouchableOpacity
            onPress={() => setUseOtherPickup((v) => !v)}
            style={S.toggle}
            activeOpacity={0.8}
          >
            <View style={[S.checkbox, useOtherPickup && S.checkboxOn]} />
            <Text style={S.toggleTxt}>
              {useOtherPickup
                ? "אדם אחר מוסר את החבילה"
                : "אני מוסרת/מוסר את החבילה"}
            </Text>
          </TouchableOpacity>

          {useOtherPickup && (
            <>
              <View style={S.field}>
                <Text style={S.label}>שם *</Text>
                <TextInput
                  style={S.input}
                  placeholder="לדוגמה: דנה כהן"
                  value={pickupName}
                  onChangeText={setPickupName}
                  textAlign="right"
                />
              </View>
              <View style={S.field}>
                <Text style={S.label}>נייד *</Text>
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

      {/* Date/Time picker modal */}
      <DateTimePickerModal
        isVisible={pickerVisible}
        mode={pickerPhase === "date" ? "date" : "time"}
        date={tempDate}
        onConfirm={onConfirmPicker}
        onCancel={onCancelPicker}
        locale="he-IL"
        confirmTextIOS={pickerPhase === "date" ? "בחירת שעה" : "אישור"}
        cancelTextIOS="ביטול"
      />
    </View>
  );
}

const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg, padding: 16 },

  // Stepbar
  stepbar: {
    flexDirection: "row-reverse",
    alignItems: "center",
    marginBottom: 12,
  },
  stepItem: { flexDirection: "row-reverse", alignItems: "center", flex: 1 },
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
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    // subtle shadow
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: {
    fontWeight: "900",
    color: COLORS.primaryDark,
    marginBottom: 8,
    textAlign: "right",
  },

  // Fields
  field: { marginBottom: 10 },
  label: { fontWeight: "800", color: COLORS.text, textAlign: "right" },
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
  hint: { marginTop: 6, color: COLORS.dim, textAlign: "right" },

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
  pickerLabel: { color: COLORS.dim, fontWeight: "700", textAlign: "right" },
  pickerValue: {
    marginTop: 4,
    fontWeight: "900",
    color: COLORS.text,
    textAlign: "right",
  },

  // Toggle
  toggle: {
    flexDirection: "row-reverse",
    alignItems: "center",
    marginBottom: 6,
  },
  toggleTxt: { marginRight: 8, color: COLORS.text, fontWeight: "700" },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: "transparent",
  },
  checkboxOn: { backgroundColor: COLORS.primary },

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
});
