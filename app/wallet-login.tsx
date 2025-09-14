// app/wallet-login.tsx
// Guided, RTL-first flow without debug prints.
// (Only the "Steps" UI was modified to enforce RTL order.)

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  AppState,
  AppStateStatus,
  ScrollView,
  Alert,
} from "react-native";
import * as Linking from "expo-linking";
import QRCode from "react-native-qrcode-svg";
import { useRouter } from "expo-router";
import AnimatedBgBlobs from "./components/AnimatedBgBlobs";

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
  good: "#16a34a",
};

type StepStatus = "done" | "current" | "upcoming";

export default function WalletLogin() {
  const router = useRouter();

  // Core state
  const [session, setSession] = useState<WCSessionInfo | null>(null);
  const [serverAddress, setServerAddress] = useState<string | null>(null);
  const [nonce, setNonce] = useState("");
  const [messageToSign, setMessageToSign] = useState("");

  // UI state
  const [busy, setBusy] = useState<
    "idle" | "connecting" | "nonce" | "signing" | "verifying"
  >("idle");
  const [err, setErr] = useState<string | null>(null);

  // WalletConnect pairing
  const [wcUri, setWcUri] = useState<string | null>(null);
  const approvalPromiseRef = useRef<Promise<WCSessionInfo> | null>(null);
  const finalizingRef = useRef(false);

  const nonceReady = !!nonce && !!messageToSign;

  // Compute step statuses
  const step1: StepStatus = !session ? "current" : "done";
  const step2: StepStatus = session
    ? nonceReady
      ? "done"
      : "current"
    : "upcoming";
  const step3: StepStatus = nonceReady ? "current" : "upcoming";

  const requestNonce = useCallback(async (addressFromWallet: string) => {
    setBusy("nonce");
    setErr(null);
    try {
      const { nonce, message_to_sign, wallet_address } = await getNonce(
        addressFromWallet
      );
      setNonce(nonce);
      setMessageToSign(message_to_sign);
      setServerAddress(wallet_address || addressFromWallet);
    } catch (e: any) {
      setErr(e?.message || "יצירת Nonce נכשלה");
      Alert.alert("שגיאה", String(e?.message || e));
    } finally {
      setBusy("idle");
    }
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
    } catch (e: any) {
      setErr(e?.message || "אישור הארנק נכשל");
    } finally {
      finalizingRef.current = false;
    }
  }, [requestNonce]);

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
  }, [finalizeAfterApproval]);

  const handleSignAndVerify = useCallback(async () => {
    if (!session?.topic || !session?.address || !messageToSign) {
      setErr("חסר session או הודעה לחתימה.");
      return;
    }
    const addressForServer = serverAddress ?? session.address;

    setErr(null);
    try {
      setBusy("signing");

      const signPromise = wcSignMessage(
        session.topic,
        session.address,
        messageToSign
      );

      const t1 = setTimeout(() => bringSubWalletToFront().catch(() => {}), 200);
      const t2 = setTimeout(
        () => bringSubWalletToFront().catch(() => {}),
        3000
      );

      const signature = await signPromise;
      clearTimeout(t1);
      clearTimeout(t2);

      setBusy("verifying");
      const { token } = await verifySignature({
        address: addressForServer,
        message: messageToSign,
        signature,
      });

      const tokenStr = String(token);

      let completed = false;
      try {
        const me = await getMyProfile(tokenStr);
        completed =
          !!me?.first_login_completed ||
          (!!me?.first_name &&
            !!me?.last_name &&
            !!me?.phone &&
            !!me?.email &&
            !!me?.city);
      } catch {
        completed = false;
      }

      setBusy("idle");

      if (completed) {
        router.replace({ pathname: "/home_page", params: { token: tokenStr } });
      } else {
        router.replace({
          pathname: "/profile-setup",
          params: { token: tokenStr },
        });
      }
    } catch (e: any) {
      setBusy("idle");
      setErr(e?.message || "חתימה/אימות נכשלו");
      Alert.alert("שגיאה", String(e?.message || e));
    }
  }, [session, messageToSign, serverAddress, router]);

  return (
    <View style={styles.screen}>
      <AnimatedBgBlobs />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          { flexGrow: 1, justifyContent: "center" },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Steps header (RTL) */}
        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>צעדים</Text>
          <Step label="התחברות לארנק" index={1} status={step1} />
          <Step label="יצירת Nonce" index={2} status={step2} />
          <Step label="חתימה ואימות" index={3} status={step3} />
        </View>

        {/* Main card */}
        <View style={styles.card}>
          {!session ? (
            <>
              <Text style={styles.cardTitle}>התחברות עם SubWallet</Text>
              <Text style={styles.cardSub}>
                התחבר/י לארנק כדי להמשיך. לאחר האישור ניצור עבורך נונס לחתימה.
              </Text>

              <TouchableOpacity
                style={[styles.btnPrimary, { marginTop: 12 }]}
                onPress={handleConnect}
                disabled={busy === "connecting"}
              >
                <Text style={styles.btnPrimaryText}>
                  {busy === "connecting" ? "מתחבר/ת…" : "התחבר/י עם SubWallet"}
                </Text>
              </TouchableOpacity>

              {!!wcUri && (
                <View style={{ alignItems: "center", marginTop: 14 }}>
                  <Text style={[styles.label, { textAlign: "center" }]}>
                    סרקו את הקוד באפליקציית SubWallet כדי לאשר את ההתחברות.
                  </Text>
                  <View style={styles.qrWrap}>
                    <QRCode value={wcUri} size={170} />
                  </View>
                  <TouchableOpacity
                    style={[styles.btnOutline, { marginTop: 10 }]}
                    onPress={() => wcUri && openSubWalletOrStore(wcUri)}
                  >
                    <Text style={styles.btnOutlineText}>
                      פתח/י את SubWallet עכשיו
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : (
            <>
              <View style={styles.statusRow}>
                <View style={styles.badgeOk}>
                  <Text style={styles.badgeOkText}>מחובר/ת ✓</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.btnPrimary,
                  { marginTop: 12 },
                  nonceReady && styles.btnDisabled,
                ]}
                onPress={() => requestNonce(session.address)}
                disabled={busy !== "idle" || nonceReady}
              >
                <Text style={styles.btnPrimaryText}>
                  {busy === "nonce"
                    ? "מכין Nonce"
                    : nonceReady
                    ? "Nonce מוכן ✓"
                    : "צור/י Nonce"}
                </Text>
              </TouchableOpacity>

              {nonceReady && (
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
              )}
            </>
          )}

          {!!err && (
            <View style={styles.errBox}>
              <Text style={styles.errText}>{err}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/* --------------------------- Only the STEPS below were changed --------------------------- */

function Step({
  label,
  index,
  status,
}: {
  label: string;
  index: number;
  status: StepStatus;
}) {
  const isDone = status === "done";
  const isCurrent = status === "current";
  const isUpcoming = status === "upcoming";

  // RTL: DOT first, then LABEL. The row should be right-aligned via styles.stepRow.
  return (
    <View style={styles.stepRow}>
      {/* DOT (right-most) */}
      <View
        style={[
          styles.stepDot,
          isDone && styles.stepDotDone,
          isCurrent && styles.stepDotCurrent,
        ]}
      >
        <Text
          style={[
            styles.stepDotText,
            isDone && styles.stepDotTextDone,
            isCurrent && styles.stepDotTextCurrent,
          ]}
        >
          {isDone ? "✓" : index}
        </Text>
      </View>

      {/* LABEL (to the left of the dot) */}
      <Text
        style={[
          styles.stepLabel,
          isDone && { color: COLORS.good },
          isCurrent && { color: COLORS.primaryDark },
          isUpcoming && { color: COLORS.dim },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/* -------------------------------- Styles -------------------------------- */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 28, alignItems: "center" },

  stepsCard: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  stepsTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 8,
    writingDirection: "rtl",
    textAlign: "left",
  },
  stepRow: {
    flexDirection: "row", // normal order: [dot, label]
    justifyContent: "flex-start", // push row content to the RIGHT edge
    alignItems: "center",
    marginBottom: 8,
  },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10, // spacing between dot (right) and label (left)
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  stepDotCurrent: {
    backgroundColor: "#eef6ea",
    borderColor: COLORS.primary,
  },
  stepDotDone: {
    backgroundColor: "#e8f7ec",
    borderColor: "#bbf7d0",
  },
  stepDotText: { color: COLORS.dim, fontWeight: "800", fontSize: 12 },
  stepDotTextCurrent: { color: COLORS.primaryDark },
  stepDotTextDone: { color: COLORS.good },
  stepLabel: {
    fontWeight: "800",
    fontSize: 14,
    writingDirection: "ltr",
    textAlign: "right",
    flexShrink: 1,
  },

  card: {
    marginTop: 4,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    width: "100%",
    maxWidth: 520,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.text,
    writingDirection: "rtl",
    textAlign: "center",
  },
  cardSub: {
    fontSize: 13,
    color: COLORS.dim,
    marginTop: 4,
    writingDirection: "rtl",
    textAlign: "center",
  },

  label: { fontSize: 12, color: COLORS.dim, writingDirection: "rtl" },
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
  btnDisabled: { opacity: 0.7 },

  btnOutline: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: COLORS.primaryDark,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  btnOutlineText: { color: COLORS.primaryDark, fontWeight: "800" },

  statusRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  badgeOk: {
    backgroundColor: "#e8f7ec",
    borderColor: "#bbf7d0",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  badgeOkText: { color: COLORS.good, fontWeight: "800", fontSize: 12 },

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
