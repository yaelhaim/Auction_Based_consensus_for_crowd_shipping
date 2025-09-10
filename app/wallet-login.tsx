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
  Platform,
  ToastAndroid,
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
  bringSubWalletToFront,
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

  const [session, setSession] = useState<WCSessionInfo | null>(null);
  const [nonce, setNonce] = useState("");
  const [messageToSign, setMessageToSign] = useState("");
  const [busy, setBusy] = useState<
    "idle" | "connecting" | "nonce" | "signing" | "verifying"
  >("idle");
  const [err, setErr] = useState<string | null>(null);

  const [wcUri, setWcUri] = useState<string | null>(null);
  const [waitForApproval, setWaitForApproval] = useState<
    null | (() => Promise<WCSessionInfo>)
  >(null);

  const approvalPromiseRef = useRef<Promise<WCSessionInfo> | null>(null);
  const finalizingRef = useRef(false);

  const log = (...a: any[]) => {
    if (__DEV__) console.log("[WalletLogin]", ...a);
  };

  const requestNonce = useCallback(async (address: string) => {
    setBusy("nonce");
    const { nonce, message_to_sign } = await getNonce(address);
    setNonce(nonce);
    setMessageToSign(message_to_sign);
    setBusy("idle");
    Alert.alert("מחוברת", "Nonce נוצר. אפשר לחתום.");
  }, []);

  const finalizeAfterApproval = useCallback(async () => {
    if (finalizingRef.current) return;
    const p = approvalPromiseRef.current;
    if (!p) {
      log("finalize: no approval promise");
      return;
    }

    finalizingRef.current = true;
    try {
      log("finalize: waiting for approval()");
      const s = await p;
      log("finalize: approved", s?.topic, s?.address);
      approvalPromiseRef.current = null;
      setSession(s);
      setWcUri(null);
      setWaitForApproval(null);
      await requestNonce(s.address);
    } catch (e: any) {
      log("finalize: not approved yet / failed:", e?.message || e);
    } finally {
      finalizingRef.current = false;
    }
  }, [requestNonce]);

  useEffect(() => {
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === "active") finalizeAfterApproval();
    };
    const sub = AppState.addEventListener("change", onAppStateChange);
    return () => sub.remove();
  }, [finalizeAfterApproval]);

  useEffect(() => {
    const onUrl = ({ url }: { url: string }) => {
      log("Deep link received:", url);
      finalizeAfterApproval();
    };
    const sub = Linking.addEventListener("url", onUrl);
    (async () => {
      const firstUrl = await Linking.getInitialURL();
      if (firstUrl) onUrl({ url: firstUrl });
    })();
    return () => sub.remove();
  }, [finalizeAfterApproval]);

  const handleConnect = useCallback(async () => {
    setErr(null);
    setWcUri(null);
    setWaitForApproval(null);
    approvalPromiseRef.current = null;

    try {
      setBusy("connecting");
      log("connect(): wcConnect()");
      const res: WCConnectResult = await wcConnect();
      setBusy("idle");
      log("connect(): result type =", res.type);

      if (res.type === "approved") {
        setSession(res.session);
        await requestNonce(res.session.address);
      } else {
        setWcUri(res.uri);
        setWaitForApproval(() => res.waitForApproval);
        approvalPromiseRef.current = res.waitForApproval();
        log("connect(): got uri (len)", res.uri.length);

        openSubWalletOrStore(res.uri)
          .then((hint) => {
            log("openSubWalletOrStore() →", hint);
            if (hint === "noop" || hint === "store") {
              setTimeout(() => {
                openSubWalletOrStore(res.uri)
                  .then((h) => log("retry open →", h))
                  .catch((e) => log("retry open error:", e));
              }, 600);
            }
          })
          .catch((e) => log("openSubWalletOrStore error:", e));

        finalizeAfterApproval();
      }
    } catch (e: any) {
      setBusy("idle");
      const msg = e?.message || "החיבור נכשל";
      log("connect() error:", msg);
      setErr(msg);
    }
  }, [requestNonce, finalizeAfterApproval]);

  const handleApproveAfterQr = useCallback(async () => {
    if (!approvalPromiseRef.current) {
      Alert.alert(
        "אין עדיין אישור מהארנק",
        "פתחי את SubWallet ואשרי את החיבור (או סרקי את ה-QR) ואז חזרי."
      );
      log("approve CTA: no approval promise");
      return;
    }
    await finalizeAfterApproval();
  }, [finalizeAfterApproval]);

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

  // ✅ Sign flow: first send request, THEN bring wallet to front (so it shows the sign prompt, not "connection succeeded")
  const handleSignAndVerify = useCallback(async () => {
    if (!session?.topic || !session?.address || !messageToSign) {
      Alert.alert("שגיאה", "חסר session או הודעה לחתימה.");
      return;
    }
    setErr(null);

    try {
      setBusy("signing");
      const logMsg = (...a: any[]) =>
        __DEV__ && console.log("[WalletLogin] sign:", ...a);

      // 1) שליחת בקשת חתימה מיד
      logMsg("request polkadot_signMessage");
      const signPromise = wcSignMessage(
        session.topic,
        session.address,
        messageToSign
      );

      // 2) אחרי ~200ms מעלים את הארנק לפרונט כדי להציג את חלון החתימה הנכון
      const bringTimer = setTimeout(() => {
        logMsg("bring wallet to front for sign prompt");
        bringSubWalletToFront().catch(() => {});
      }, 200);

      // 3) אם תוך 3 שניות אין prompt – ננסה שוב להבליט
      const nudgeTimer = setTimeout(() => {
        logMsg("no prompt yet → bringToFront again");
        bringSubWalletToFront().catch(() => {});
      }, 3000);

      const signature = await signPromise;
      clearTimeout(bringTimer);
      clearTimeout(nudgeTimer);

      // 4) אימות בצד שרת
      setBusy("verifying");
      const { token } = await verifySignature({
        address: session.address,
        message: messageToSign,
        signature,
      });

      setBusy("idle");
      Alert.alert("התחברת", token ? `token: ${token.slice(0, 12)}…` : "OK");
      router.replace("/home");
    } catch (e: any) {
      setBusy("idle");
      const m = e?.message || "חתימה/אימות נכשלו";
      __DEV__ && console.log("[WalletLogin] sign error:", m);
      if (m.includes("request") || m.includes("timeout")) {
        Alert.alert(
          "לא התקבלה חתימה",
          "אם לא הופיע חלון חתימה בארנק, פתחי את SubWallet ידנית ואשרי. אפשר גם ללחוץ שוב 'פתחי את SubWallet עכשיו'."
        );
      }
      setErr(m);
    }
  }, [session, messageToSign, router]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>התחברות עם SubWallet</Text>
      <Text style={styles.subtitle}>
        חיבור לארנק → יצירת nonce → חתימה באפליקציה → אימות בשרת.
      </Text>

      <View style={styles.card}>
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={handleConnect}
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

        {wcUri && (
          <View style={{ alignItems: "center", marginTop: 16 }}>
            <Text style={[styles.label, { textAlign: "center" }]}>
              פתחנו את הארנק. אם לא נפתח, נסי לפתוח ידנית או סרקי את ה-QR.
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

            <TouchableOpacity
              style={[styles.btnOutline, { marginTop: 10 }]}
              onPress={async () => {
                if (!wcUri) return;
                try {
                  const hint = await openSubWalletOrStore(wcUri);
                  log("manual openSubWalletOrStore →", hint);
                  if (hint === "store" || hint === "noop") {
                    const msg =
                      "לא הצלחתי לפתוח את SubWallet. נסי לסרוק את ה-QR.";
                    Platform.OS === "android"
                      ? ToastAndroid.show(msg, ToastAndroid.SHORT)
                      : Alert.alert("שימי לב", msg);
                  }
                } catch (e) {
                  log("manual open error:", e);
                }
              }}
            >
              <Text style={styles.btnOutlineText}>פתחי את SubWallet עכשיו</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btnOutline, { marginTop: 10 }]}
              onPress={handleApproveAfterQr}
            >
              <Text style={styles.btnOutlineText}>חזרתי מהארנק — המשך</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btnOutline, { marginTop: 10 }]}
              onPress={async () => {
                log("reset pairing → reconnect");
                approvalPromiseRef.current = null;
                setWcUri(null);
                setWaitForApproval(null);
                try {
                  setBusy("connecting");
                  const res = await wcConnect();
                  setBusy("idle");
                  if (res.type === "approved") {
                    setSession(res.session);
                    await requestNonce(res.session.address);
                  } else {
                    setWcUri(res.uri);
                    setWaitForApproval(() => res.waitForApproval);
                    approvalPromiseRef.current = res.waitForApproval();
                    openSubWalletOrStore(res.uri).catch(() => {});
                  }
                } catch (e: any) {
                  setBusy("idle");
                  setErr(e?.message || "החיבור נכשל");
                }
              }}
            >
              <Text style={styles.btnOutlineText}>נסי חיבור מחדש</Text>
            </TouchableOpacity>

            <Text style={[styles.label, { marginTop: 8, textAlign: "center" }]}>
              {wcUri.slice(0, 42)}…
            </Text>
          </View>
        )}

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
