// UI for wallet login flow with:
//   Connect → (auto open wallet or store) → (QR fallback) → Nonce → Sign → Verify
// Auto-resume: when returning from wallet (deep link or app focus), we finalize approval
// WITHOUT locking the UI while waiting for wallet approval.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  AppState,
  AppStateStatus,
} from "react-native";
import * as Linking from "expo-linking";
import QRCode from "react-native-qrcode-svg";
import { useRouter } from "expo-router";

import {
  connect as wcConnect,
  signMessage as wcSignMessage,
  WCSessionInfo,
  WCConnectResult,
  openSubWalletOrStore,
} from "../lib/wc";
import { getNonce, verifySignature } from "../lib/api";

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

  // WalletConnect session (topic + address)
  const [session, setSession] = useState<WCSessionInfo | null>(null);
  // Server-provided fields
  const [nonce, setNonce] = useState("");
  const [messageToSign, setMessageToSign] = useState("");
  // UI state
  const [busy, setBusy] = useState<
    "idle" | "connecting" | "nonce" | "signing" | "verifying"
  >("idle");
  const [err, setErr] = useState<string | null>(null);

  // Pairing URI + deferred approval
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [waitForApproval, setWaitForApproval] = useState<
    null | (() => Promise<WCSessionInfo>)
  >(null);

  // Keep a single approval promise to avoid multiple awaits
  const approvalPromiseRef = useRef<Promise<WCSessionInfo> | null>(null);
  const finalizingRef = useRef(false); // prevent concurrent finalize runs

  // Request nonce + message_to_sign from backend
  const requestNonce = useCallback(async (address: string) => {
    setBusy("nonce");
    const { nonce, message_to_sign } = await getNonce(address);
    setNonce(nonce);
    setMessageToSign(message_to_sign); // use server string as-is
    setBusy("idle");
    Alert.alert("מחוברת", "Nonce נוצר. אפשר לחתום.");
  }, []);

  // Central finalize function (don’t lock UI)
  const finalizeAfterApproval = useCallback(async () => {
    if (finalizingRef.current) return;
    const p = approvalPromiseRef.current;
    if (!p) return;

    finalizingRef.current = true;
    try {
      const s = await p; // resolve once
      approvalPromiseRef.current = null;
      setSession(s);
      setWcUri(null);
      setWaitForApproval(null);
      await requestNonce(s.address);
    } catch {
      // If not approved yet, we just ignore and will try again on next trigger
    } finally {
      finalizingRef.current = false;
    }
  }, [requestNonce]);

  // ---- Auto-resume on app focus (user returns from wallet manually) ----
  useEffect(() => {
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === "active") finalizeAfterApproval();
    };
    const sub = AppState.addEventListener("change", onAppStateChange);
    return () => sub.remove();
  }, [finalizeAfterApproval]);

  // ---- Handle deep-link callback (biddrop://wc-callback) & initial URL ----
  useEffect(() => {
    const onUrl = ({ url }: { url: string }) => {
      if (__DEV__) console.log("Deep link received:", url);
      finalizeAfterApproval();
    };
    const sub = Linking.addEventListener("url", onUrl);

    // In case app launched via deep link
    (async () => {
      const firstUrl = await Linking.getInitialURL();
      if (firstUrl) onUrl({ url: firstUrl });
    })();

    return () => sub.remove();
  }, [finalizeAfterApproval]);

  // 1) Connect to wallet (auto-open SubWallet; QR fallback stays visible)
  const handleConnect = useCallback(async () => {
    setErr(null);
    setWcUri(null);
    setWaitForApproval(null);
    approvalPromiseRef.current = null;

    try {
      setBusy("connecting");
      const res: WCConnectResult = await wcConnect();
      setBusy("idle"); // release UI immediately

      if (res.type === "approved") {
        setSession(res.session);
        await requestNonce(res.session.address);
      } else {
        // We have a pairing URI and a deferred approval promise
        setWcUri(res.uri);
        setWaitForApproval(() => res.waitForApproval);
        // Keep a single promise instance
        approvalPromiseRef.current = res.waitForApproval();

        // Try to open SubWallet (best-effort). QR remains as fallback.
        openSubWalletOrStore(res.uri).catch(() => {});
        // Also try finalize immediately (in case approval already happened)
        finalizeAfterApproval();
      }
    } catch (e: any) {
      setBusy("idle");
      setErr(e?.message || "החיבור נכשל");
    }
  }, [requestNonce, finalizeAfterApproval]);

  // 1b) After user scanned/approved in wallet (manual CTA)
  const handleApproveAfterQr = useCallback(async () => {
    // Just try to finalize using the stored promise
    await finalizeAfterApproval();
  }, [finalizeAfterApproval]);

  // 2) Manual nonce refresh
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
      const signature = await wcSignMessage(
        session.topic,
        session.address,
        messageToSign
      );
      setBusy("verifying");
      const { token } = await verifySignature({
        address: session.address,
        message: messageToSign, // must match signed string
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
      <Text style={styles.title}>התחברות עם SubWallet</Text>
      <Text style={styles.subtitle}>
        חיבור לארנק → יצירת nonce → חתימה באפליקציה → אימות בשרת.
      </Text>

      <View style={styles.card}>
        {/* Connect */}
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={handleConnect}
          // לא ננעל על "connecting" כדי לאפשר לוזר להמשיך לנווט/ללחוץ
          disabled={busy === "signing" || busy === "verifying"}
        >
          <Text style={styles.btnPrimaryText}>
            {busy === "connecting"
              ? "מתחבר…"
              : session
              ? "מחובר ✓"
              : "התחברי עם SubWallet"}
          </Text>
        </TouchableOpacity>

        {/* Pairing: show QR and continue after approval (fallback stays visible) */}
        {wcUri && (
          <View style={{ alignItems: "center", marginTop: 16 }}>
            <Text style={[styles.label, { textAlign: "center" }]}>
              פתחנו את הארנק. אם לא נפתח, סרקי את ה-QR או חזרי לאפליקציה ולחצי
              "חזרתי מהארנק — המשך".
            </Text>

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

            {/* כפתור המשך ידני — תמיד לחיץ */}
            <TouchableOpacity
              style={[styles.btnOutline, { marginTop: 12 }]}
              onPress={handleApproveAfterQr}
            >
              <Text style={styles.btnOutlineText}>חזרתי מהארנק — המשך</Text>
            </TouchableOpacity>

            <Text style={[styles.label, { marginTop: 8, textAlign: "center" }]}>
              {wcUri.slice(0, 42)}…
            </Text>
          </View>
        )}

        {/* After session → show address, nonce, sign/verify */}
        {session && (
          <>
            <View className="row" style={styles.row}>
              <Text style={styles.label}>כתובת:</Text>
              <Text style={styles.val}>
                {session.address.slice(0, 10)}…{session.address.slice(-6)}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.btnOutline, { marginTop: 10 }]}
              onPress={handleNonce}
              disabled={busy !== "idle"} // כאן כן ננעל בזמן בקשת nonce/חתימה
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
                  disabled={busy === "signing" || busy === "verifying"}
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
  btnOutlineText: { color: COLORS.primaryDark, fontWeight: "800" },
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
