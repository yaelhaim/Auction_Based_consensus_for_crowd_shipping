// Wallet login flow: Connect → Nonce → Sign → Verify
// Clean UI: smaller QR, centered layout, auto navigation.

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
  Platform,
} from "react-native";
import * as Linking from "expo-linking";
import QRCode from "react-native-qrcode-svg";
import { useRouter } from "expo-router";
import AnimatedBgBlobs from "./components/AnimatedBgBlobs"; // ⭐ רקע דינאמי

import {
  connect as wcConnect,
  signMessage as wcSignMessage,
  WCSessionInfo,
  WCConnectResult,
  openSubWalletOrStore,
  bringSubWalletToFront,
} from "../lib/wc";
import { getNonce, verifySignature, getMyProfile } from "../lib/api";

const COLORS = {
  bg: "#ffffff",
  text: "#060606",
  dim: "#6b7280",
  primary: "#9bac70",
  primaryDark: "#475530",
  border: "#e5e7eb",
  error: "#b91c1c",
};

export default function WalletLogin() {
  const router = useRouter();

  const [session, setSession] = useState<WCSessionInfo | null>(null);
  const [nonce, setNonce] = useState("");
  const [messageToSign, setMessageToSign] = useState("");
  const [busy, setBusy] = useState<
    "idle" | "connecting" | "nonce" | "signing" | "verifying"
  >("idle");
  const [err, setErr] = useState<string | null>(null);

  const [wcUri, setWcUri] = useState<string | null>(null);
  const approvalPromiseRef = useRef<Promise<WCSessionInfo> | null>(null);
  const finalizingRef = useRef(false);

  const requestNonce = useCallback(async (address: string) => {
    setBusy("nonce");
    const { nonce, message_to_sign } = await getNonce(address);
    setNonce(nonce);
    setMessageToSign(message_to_sign);
    setBusy("idle");
  }, []);

  const finalizeAfterApproval = useCallback(async () => {
    if (finalizingRef.current) return;
    const p = approvalPromiseRef.current;
    if (!p) return;

    finalizingRef.current = true;
    try {
      const s = await p;
      approvalPromiseRef.current = null;
      setSession(s);
      setWcUri(null);
      await requestNonce(s.address);
    } finally {
      finalizingRef.current = false;
    }
  }, [requestNonce]);

  // Resume when app returns to foreground / deep link arrives
  useEffect(() => {
    const onAppState = (st: AppStateStatus) => {
      if (st === "active") finalizeAfterApproval();
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => sub.remove();
  }, [finalizeAfterApproval]);

  useEffect(() => {
    const onUrl = () => finalizeAfterApproval();
    const sub = Linking.addEventListener("url", onUrl);
    (async () => {
      const first = await Linking.getInitialURL();
      if (first) onUrl();
    })();
    return () => sub.remove();
  }, [finalizeAfterApproval]);

  const handleConnect = useCallback(async () => {
    setErr(null);
    setWcUri(null);
    approvalPromiseRef.current = null;
    try {
      setBusy("connecting");
      const res: WCConnectResult = await wcConnect();
      setBusy("idle");

      if (res.type === "approved") {
        setSession(res.session);
        await requestNonce(res.session.address);
      } else {
        setWcUri(res.uri);
        approvalPromiseRef.current = res.waitForApproval();
        openSubWalletOrStore(res.uri).catch(() => {});
        finalizeAfterApproval();
      }
    } catch (e: any) {
      setBusy("idle");
      setErr(e?.message || "החיבור נכשל");
    }
  }, [requestNonce, finalizeAfterApproval]);

  const handleSignAndVerify = useCallback(async () => {
    if (!session?.topic || !session?.address || !messageToSign) {
      setErr("חסר session או הודעה לחתימה.");
      return;
    }
    setErr(null);
    try {
      setBusy("signing");
      const signPromise = wcSignMessage(
        session.topic,
        session.address,
        messageToSign
      );

      // surface wallet sign prompt
      const t1 = setTimeout(() => {
        bringSubWalletToFront().catch(() => {});
      }, 200);
      const t2 = setTimeout(() => {
        bringSubWalletToFront().catch(() => {});
      }, 3000);

      const signature = await signPromise;
      clearTimeout(t1);
      clearTimeout(t2);

      setBusy("verifying");
      const { token, is_new_user } = await verifySignature({
        address: session.address,
        message: messageToSign,
        signature,
      });

      setBusy("idle");

      const tokenStr = String(token);

      if (is_new_user === true) {
        router.replace({
          pathname: "/profile-setup",
          params: { token: tokenStr },
        });
      } else {
        try {
          const me = await getMyProfile(tokenStr);
          if (!me || !me.first_name) {
            router.replace({
              pathname: "/profile-setup",
              params: { token: tokenStr },
            });
            return;
          }
        } catch {
          router.replace({
            pathname: "/profile-setup",
            params: { token: tokenStr },
          });
          return;
        }
        router.replace("/home");
      }
    } catch (e: any) {
      setBusy("idle");
      setErr(e?.message || "חתימה/אימות נכשלו");
    }
  }, [session, messageToSign, router]);

  return (
    <View style={styles.screen}>
      {/* ⭐ רקע דינאמי */}
      <AnimatedBgBlobs />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          { flexGrow: 1, justifyContent: "center" },
        ]} // ⭐ מרכז אנכית
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>התחברות עם SubWallet</Text>
        <Text style={styles.subtitle}>
          חיבור לארנק → יצירת Nonce → חתימה → אימות.
        </Text>

        <View style={styles.card}>
          {/* Connect / Connected */}
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={handleConnect}
            disabled={busy === "signing" || busy === "verifying"}
          >
            <Text style={styles.btnPrimaryText}>
              {busy === "connecting"
                ? "מתחברת…"
                : session
                ? "מחוברת ✓"
                : "התחברי עם SubWallet"}
            </Text>
          </TouchableOpacity>

          {/* QR (smaller) with a clear caption */}
          {wcUri && (
            <View style={{ alignItems: "center", marginTop: 14 }}>
              <Text style={[styles.label, { textAlign: "center" }]}>
                אפשר לסרוק את הקוד באפליקציית SubWallet כדי לאשר את ההתחברות.
              </Text>
              <View style={styles.qrWrap}>
                <QRCode value={wcUri} size={170} />
              </View>
              <TouchableOpacity
                style={[styles.btnOutline, { marginTop: 10 }]}
                onPress={() => wcUri && openSubWalletOrStore(wcUri)}
              >
                <Text style={styles.btnOutlineText}>
                  פתחי את SubWallet עכשיו
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Address + Nonce */}
          {session && (
            <>
              <View style={styles.row}>
                <Text style={styles.label}>כתובת</Text>
                <Text style={styles.val}>
                  {session.address.slice(0, 10)}…{session.address.slice(-6)}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.btnOutline, { marginTop: 10 }]}
                onPress={() => requestNonce(session.address)}
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 28, alignItems: "center" }, // ⭐ אלמנטים באמצע
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center",
    writingDirection: "rtl",
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.dim,
    marginTop: 6,
    textAlign: "center",
    lineHeight: 18,
    writingDirection: "rtl",
  },
  card: {
    marginTop: 16,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    width: "100%",
    maxWidth: 520, // ⭐ נראה טוב במסכים רחבים וקטנים
  },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  label: { fontSize: 12, color: COLORS.dim, writingDirection: "rtl" },
  val: { fontSize: 12, color: COLORS.text },
  msgBox: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 8,
    backgroundColor: "#fafafa",
  },
  msgText: { color: COLORS.text, fontSize: 12 },
  qrWrap: {
    padding: 10,
    backgroundColor: "#fff",
    borderRadius: 12,
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  btnPrimaryText: { color: "#fff", fontWeight: "800" },
  btnOutline: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: COLORS.primaryDark,
    paddingVertical: 10,
    borderRadius: 12,
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
    width: "100%",
    maxWidth: 520,
  },
  errText: { color: COLORS.error, textAlign: "center" },
});
