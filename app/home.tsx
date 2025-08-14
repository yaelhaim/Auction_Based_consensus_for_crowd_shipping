import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Modal, Pressable, Linking, I18nManager } from 'react-native';
import { useRouter } from 'expo-router';

// ודאי שה־RTL פעיל אם צריך
I18nManager.allowRTL(true);

export default function HomeScreen() {
  const router = useRouter();
  const [helpVisible, setHelpVisible] = useState(false);

  return (
    <View style={styles.container}>
      {/* Logo */}
      <Image 
        source={require('../assets/images/icon.png')} 
        style={styles.logo}
        resizeMode="contain"
      />

      {/* Short description */}
      <Text style={styles.title}>ברוכ/ה הבאה ל-Bid Drop</Text>
      <Text style={styles.subtitle}>
        בשלב זה נדרש זיהוי והתחברות דרך ארנק דיגיטלי.
      </Text>

      {/* register*/}
<TouchableOpacity
  style={[styles.buttonPrimary, { marginBottom: 12 }]} // רווח אנכי
  onPress={() => router.push('/register')}
  accessibilityLabel="Register"
>
  <Text style={styles.buttonPrimaryText}>הרשמה</Text>
</TouchableOpacity>

{/* conect wollt*/}
<TouchableOpacity
  style={styles.buttonPrimary}
  onPress={() => router.push('/connect-wallet')}
  accessibilityLabel="Connect Digital Wallet"
>
  <Text style={styles.buttonPrimaryText}>התחברות לארנק דיגיטלי</Text>
</TouchableOpacity>



      {/* Sign in link */}
      <Pressable onPress={() => router.push('/signin')} accessibilityRole="link" style={{ marginTop: 12 }}>
        <Text style={styles.signInText}>כבר יש לך חשבון? <Text style={styles.signInLink}>Sign in</Text></Text>
      </Pressable>

      {/* Help: no wallet installed */}
      <Pressable onPress={() => setHelpVisible(true)} style={{ marginTop: 16 }}>
        <Text style={styles.helpText}>אין לך ארנק? צריך עזרה בהתחברות</Text>
      </Pressable>

      {/* Modal: wallet help */}
      <Modal visible={helpVisible} transparent animationType="fade" onRequestClose={() => setHelpVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>איך מתחברים עם ארנק?</Text>
            <Text style={styles.modalBody}>
              ניתן להתחבר בעזרת אפליקציית ארנק (Wallet) או באמצעות WalletConnect.
              התקיני אחת מהאופציות, ואז חזרי ללחיצה על “הרשמה / התחברות לארנק”.
            </Text>

            <View style={styles.linkList}>
              <Pressable onPress={() => Linking.openURL('https://metamask.io/')}>
                <Text style={styles.modalLink}>MetaMask (EVM)</Text>
              </Pressable>
              <Pressable onPress={() => Linking.openURL('https://www.walletconnect.com/')}>
                <Text style={styles.modalLink}>WalletConnect</Text>
              </Pressable>
              <Pressable onPress={() => Linking.openURL('https://www.subwallet.app/')}>
                <Text style={styles.modalLink}>SubWallet (Substrate/Polkadot)</Text>
              </Pressable>
            </View>

            <TouchableOpacity style={styles.buttonSecondary} onPress={() => setHelpVisible(false)}>
              <Text style={styles.buttonSecondaryText}>סגירה</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const COLORS = {
  bg: '#ffffff',
  primary: '#475530',   // ירוק כהה
  primarySoft: '#9bac70', // ירוק בהיר
  text: '#222',
  textDim: '#6b7280',
  border: '#e5e7eb'
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20
  },
  logo: {
    width: 140,
    height: 140,
    marginBottom: 12
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 4
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textDim,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 20
  },
  buttonPrimary: {
    backgroundColor: COLORS.primarySoft,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    width: '90%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2
  },
  buttonPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700'
  },
  signInText: {
    color: COLORS.textDim,
    fontSize: 14
  },
  signInLink: {
    color: COLORS.primary,
    fontWeight: '700'
  },
  helpText: {
    color: COLORS.primary,
    fontSize: 13,
    textDecorationLine: 'underline'
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 8
  },
  modalBody: {
    fontSize: 14,
    color: COLORS.textDim,
    lineHeight: 20
  },
  linkList: {
    marginTop: 12,
    gap: 8
  },
  modalLink: {
    fontSize: 15,
    color: COLORS.primary,
    textDecorationLine: 'underline',
    marginVertical: 4
  },
  buttonSecondary: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center'
  },
  buttonSecondaryText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '700'
  }
});
