// app/wallet-login.tsx
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { connect as wcConnect, signMessage as wcSignMessage, WCSessionInfo } from './lib/wc';
import { getNonce, verifySignature } from './lib/api';

const COLORS = {
  bg: '#ffffff',
  text: '#060606',
  dim: '#8a8a8a',
  primary: '#9bac70',
  primaryDark: '#475530',
  border: '#e5e7eb',
  error: '#b91c1c',
};

export default function WalletLoginAuto() {
  const router = useRouter();

  const [session, setSession] = useState<WCSessionInfo | null>(null);
  const [nonce, setNonce] = useState('');
  const [busy, setBusy] = useState<'idle' | 'connecting' | 'nonce' | 'signing' | 'verifying'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const message = useMemo(
    () => (nonce ? `Login to BidDrop\nnonce=${nonce}` : ''),
    [nonce]
  );

  // 1) חיבור ל-SubWallet דרך WalletConnect
 const handleConnect = useCallback(async () => {
  setErr(null);

  try {
    setBusy('connecting');
    const s = await wcConnect();
    setSession(s);

    // ⚠️ חדש: מיד אחרי החיבור נבקש nonce מהשרת
    setBusy('nonce');
    const res = await getNonce(s.address);
    setNonce(res.nonce);

    setBusy('idle');
    Alert.alert('מחוברת', 'Nonce נוצר. אפשר לחתום.');
  } catch (e:any) {
    setBusy('idle');
    setErr(e?.message || 'החיבור נכשל');
  }
}, []);


  // 2) בקשת nonce מהשרת לפי הכתובת מה-session
  const handleNonce = useCallback(async () => {
    if (!session?.address) {
      Alert.alert('שגיאה', 'חסרה כתובת. התחברי לארנק קודם.');
      return;
    }
    setErr(null);
    setBusy('nonce');
    try {
      const { nonce } = await getNonce(session.address);
      setNonce(nonce);
      setBusy('idle');
    } catch (e: any) {
      setBusy('idle');
      setErr(e?.message || 'נכשלה בקשת nonce');
    }
  }, [session]);

  // 3) חתימה אוטומטית בארנק על ההודעה
  const handleSignAndVerify = useCallback(async () => {
    if (!session?.topic || !session?.address || !message) {
      Alert.alert('שגיאה', 'חסר session או הודעה לחתימה.');
      return;
    }
    setErr(null);
    try {
      setBusy('signing');
      const signature = await wcSignMessage(session.topic, session.address, message);

      setBusy('verifying');
      const { token } = await verifySignature({
        address: session.address,
        message,
        signature,
      });

      setBusy('idle');
      Alert.alert('התחברת', token ? `token: ${token.slice(0, 12)}…` : 'OK');
      router.replace('/home');
    } catch (e: any) {
      setBusy('idle');
      setErr(e?.message || 'חתימה/אימות נכשלו');
    }
  }, [session, message, router]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>התחברות עם SubWallet (אוטומטי)</Text>
      <Text style={styles.subtitle}>
        חיבור לארנק → יצירת nonce → חתימה אוטומטית באפליקציה → אימות בשרת.
      </Text>

      <View style={styles.card}>
        <TouchableOpacity style={styles.btnPrimary} onPress={handleConnect} disabled={busy !== 'idle'}>
          <Text style={styles.btnPrimaryText}>
            {busy === 'connecting' ? 'מתחבר…' : session ? 'מחובר ✓' : 'התחברי עם SubWallet'}
          </Text>
        </TouchableOpacity>

        {session && (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>כתובת:</Text>
              <Text style={styles.val}>{session.address.slice(0, 10)}…{session.address.slice(-6)}</Text>
            </View>

            <TouchableOpacity style={[styles.btnOutline, { marginTop: 10 }]} onPress={handleNonce} disabled={busy !== 'idle'}>
              <Text style={styles.btnOutlineText}>
                {busy === 'nonce' ? 'יוצרת Nonce…' : (nonce ? 'Nonce נוצר ✓' : 'צרי Nonce')}
              </Text>
            </TouchableOpacity>

            {!!nonce && (
              <>
                <Text style={[styles.label, { marginTop: 12 }]}>הודעת התחברות</Text>
                <View style={styles.msgBox}>
                  <Text style={styles.msgText}>{message}</Text>
                </View>

                <TouchableOpacity
                  style={[styles.btnPrimary, { marginTop: 10 }]}
                  onPress={handleSignAndVerify}
                  disabled={busy !== 'idle'}
                >
                  {busy === 'signing' || busy === 'verifying' ? (
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
  title: { fontSize: 22, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  subtitle: { fontSize: 13, color: COLORS.dim, marginTop: 6, textAlign: 'center', lineHeight: 18 },
  card: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  label: { fontSize: 12, color: COLORS.dim },
  val: { fontSize: 12, color: COLORS.text },

  msgBox: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#fafafa',
  },
  msgText: { color: COLORS.text, fontSize: 12 },

  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800' },

  btnOutline: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: COLORS.primaryDark,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnOutlineText: { color: COLORS.primaryDark, fontWeight: '800' },

  errBox: {
    marginTop: 14,
    borderRadius: 10,
    backgroundColor: '#fdecec',
    padding: 10,
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  errText: { color: COLORS.error, textAlign: 'center' },
});
