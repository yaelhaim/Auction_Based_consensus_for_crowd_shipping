// app/wallet-login.tsx
// UI for wallet login flow with:
//   Connect → (QR if simulator / no app) → Nonce → Sign → Verify
// IMPORTANT: We sign EXACTLY the server's message_to_sign (no manual formatting).

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useRouter } from "expo-router";
import {
  connect as wcConnect,
  signMessage as wcSignMessage,
  WCSessionInfo,
  WCConnectResult,
} from "./lib/wc";
import { getNonce, verifySignature } from "./lib/api";

const COLORS = {
  bg: "#ffffff",
  text: "#060606",
  dim: "#8a8a8a",
  primary: "#9bac70",
  primaryDark: "#475530",
  border: "#e5e7eb",
  error: "#b91c1c",
};

export default function WalletLoginAuto() {
  const router = useRouter();

  // --- State management ---
  const [session, setSession] = useState<WCSessionInfo | null>(null); // WalletConnect session (topic + address)
  const [nonce, setNonce] = useState(""); // nonce from backend (for display only)
  const [messageToSign, setMessageToSign] = useState(""); // EXACT server message_to_sign
  const [busy, setBusy] = useState<
    "idle" | "connecting" | "nonce" | "signing" | "verifying"
  >("idle");
  const [err, setErr] = useState<string | null>(null);

  // When no wallet app is available (simulator / device without app), show QR:
  const [wcUri, setWcUri] = useState<string | null>(null); // WalletConnect URI for QR
  const [waitForApproval, setWaitForApproval] = useState<
    null | (() => Promise<WCSessionInfo>)
  >(null); // Deferred waiter after scanning QR

  // Helper: request nonce + message_to_sign from server and set state
  const requestNonce = useCallback(async (address: string) => {
    setBusy("nonce");
    const { nonce, message_to_sign } = await getNonce(address);
    setNonce(nonce);
    setMessageToSign(message_to_sign); // <-- critical: use server string as-is
    setBusy("idle");
    Alert.alert("מחוברת", "Nonce נוצר. אפשר לחתום.");
  }, []);

  // 1) Connect to wallet (either approved session or QR flow)
  const handleConnect = useCallback(async () => {
    setErr(null);
    setWcUri(null);
    setWaitForApproval(null);

    try {
      setBusy("connecting");
      const res: WCConnectResult = await wcConnect();

      if (res.type === "approved") {
        // Real device with wallet installed
        setSession(res.session);
        await requestNonce(res.session.address);
      } else {
        // needsWallet: show QR and wait for approval
        setWcUri(res.uri);
        setWaitForApproval(() => res.waitForApproval);
        setBusy("idle");
        Alert.alert("סריקה נדרשת", "פתחי את SubWallet בפלאפון וסרקי את ה-QR.");
      }
    } catch (e: any) {
      setBusy("idle");
      setErr(e?.message || "החיבור נכשל");
    }
  }, [requestNonce]);

  // 1b) After QR scan, wait for approval to resolve the session
  const handleApproveAfterQr = useCallback(async () => {
    if (!waitForApproval) return;
    setBusy("connecting");
    try {
      const s = await waitForApproval();
      setSession(s);
      setWcUri(null);
      setWaitForApproval(null);
      await requestNonce(s.address);
    } catch (e: any) {
      setBusy("idle");
      setErr(e?.message || "האישור נכשל");
    }
  }, [waitForApproval, requestNonce]);

  // 2) Manual nonce request (optional explicit control)
  const handleNonce = useCallback(async () => {
    if (!session?.address) {
      Alert.alert("שגיאה", "חסרה כתובת. התחברי לארנק קודם.");
      return;
    }
    setErr(null);
    try {
      await requestNonce(session.address);
    } catch (e: any) {
      setBusy("idle");
      setErr(e?.message || "נכשלה בקשת nonce");
    }
  }, [session, requestNonce]);

  // 3) Sign and verify
  const handleSignAndVerify = useCallback(async () => {
    if (!session?.topic || !session?.address || !messageToSign) {
      Alert.alert("שגיאה", "חסר session או הודעה לחתימה.");
      return;
    }
    setErr(null);
    try {
      setBusy("signing");

      // IMPORTANT: sign EXACTLY the server message (no changes)
      const signature = await wcSignMessage(
        session.topic,
        session.address,
        messageToSign
      );

      setBusy("verifying");
      const { token } = await verifySignature({
        address: session.address,
        message: messageToSign, // MUST match what we signed
        signature, // "0x..." hex
      });

      setBusy("idle");
      Alert.alert("התחברת", token ? `token: ${token.slice(0, 12)}…` : "OK");
      router.replace("/home");
    } catch (e: any) {
      setBusy("idle");
      setErr(e?.message || "חתימה/אימות נכשלו");
    }
  }, [session, messageToSign, router]);

  // --- Render ---
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>התחברות עם SubWallet (אוטומטי)</Text>
      <Text style={styles.subtitle}>
        חיבור לארנק → יצירת nonce → חתימה אוטומטית באפליקציה → אימות בשרת.
      </Text>

      <View style={styles.card}>
        {/* Connect */}
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={handleConnect}
          disabled={busy !== "idle"}
        >
          <Text style={styles.btnPrimaryText}>
            {busy === "connecting"
              ? "מתחבר…"
              : session
              ? "מחובר ✓"
              : "התחברי עם SubWallet"}
          </Text>
        </TouchableOpacity>

        {/* QR fallback (simulator / no app installed) */}
        {wcUri && (
          <View style={{ alignItems: "center", marginTop: 16 }}>
            <Text style={styles.label}>סרקי את ה-QR עם SubWallet</Text>
            <View
              style={{
                padding: 12,
                backgroundColor: "#fff",
                borderRadius: 12,
                marginTop: 8,
              }}
            >
              <QRCode value={wcUri} size={220} />
            </View>

            <TouchableOpacity
              style={[styles.btnOutline, { marginTop: 12 }]}
              onPress={handleApproveAfterQr}
              disabled={busy !== "idle"}
            >
              <Text style={styles.btnOutlineText}>
                {busy === "connecting" ? "מחכה לאישור…" : "סרקתי — המשך"}
              </Text>
            </TouchableOpacity>

            <Text style={[styles.label, { marginTop: 8, textAlign: "center" }]}>
              {wcUri.slice(0, 42)}…
            </Text>
          </View>
        )}

        {/* After session → show address, nonce, sign/verify */}
        {session && (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>כתובת:</Text>
              <Text style={styles.val}>
                {session.address.slice(0, 10)}…{session.address.slice(-6)}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.btnOutline, { marginTop: 10 }]}
              onPress={handleNonce}
              disabled={busy !== "idle"}
            >
              <Text style={styles.btnOutlineText}>
                {busy === "nonce"
                  ? "יוצרת Nonce…"
                  : nonce
                  ? "Nonce נוצר ✓"
                  : "צרי Nonce"}
              </Text>
            </TouchableOpacity>

            {!!nonce && (
              <>
                <Text style={[styles.label, { marginTop: 12 }]}>
                  הודעת התחברות
                </Text>
                <View style={styles.msgBox}>
                  <Text style={styles.msgText}>{messageToSign}</Text>
                </View>

                <TouchableOpacity
                  style={[styles.btnPrimary, { marginTop: 10 }]}
                  onPress={handleSignAndVerify}
                  disabled={busy !== "idle"}
                >
                  {busy === "signing" || busy === "verifying" ? (
                    <ActivityIndicator />
                  ) : (
                    <Text style={styles.btnPrimaryText}>חתמי ואשרי</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </View>

      {/* Error box */}
      {!!err && (
        <View style={styles.errBox}>
          <Text style={styles.errText}>{err}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 28 },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.dim,
    marginTop: 6,
    textAlign: "center",
    lineHeight: 18,
  },
  card: {
    marginTop: 16,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  label: { fontSize: 12, color: COLORS.dim },
  val: { fontSize: 12, color: COLORS.text },
  msgBox: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 8,
    backgroundColor: "#fafafa",
  },
  msgText: { color: COLORS.text, fontSize: 12 },
  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  btnPrimaryText: { color: "#fff", fontWeight: "800" },
  btnOutline: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: COLORS.primaryDark,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  btnOutlineText: {
    color: COLORS.primaryDark,
    fontWeight: "800",
  },
  errBox: {
    marginTop: 14,
    borderRadius: 10,
    backgroundColor: "#fdecec",
    padding: 10,
    borderWidth: 1,
    borderColor: "#fca5a5",
  },
  errText: { color: COLORS.error, textAlign: "center" },
});
