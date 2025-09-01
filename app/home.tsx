import React, { useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Modal,
  Pressable,
  Linking,
  I18nManager,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';

I18nManager.allowRTL(true);

const COLORS = {
  bg: '#ffffff',
  primary: '#475530',     
  primarySoft: '#9bac70', 
  text: '#060606',
  textDim: '#8a8a8a',
  border: '#e5e7eb',
};

export default function HomeScreen() {
  const router = useRouter();
  const [helpVisible, setHelpVisible] = useState(false);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Logo */}
        <Image
          source={require('../assets/images/icon.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />

        {/* Title & subtitle */}
        <Text style={styles.title}>ברוכ/ה הבאה ל-BidDrop</Text>
        <Text style={styles.subtitle}>
          כדי להמשיך נדרש זיהוי מאובטח באמצעות ארנק SubWallet.
        </Text>

        {/* Primary: Register / Connect Wallet */}
        <TouchableOpacity
          style={[styles.buttonPrimary, { marginTop: 8 }]}
          onPress={() => router.push('/wallet-login')}
          accessibilityRole="button"
          accessibilityLabel="התחברות או הרשמה עם SubWallet"
          testID="btn-connect-subwallet"
        >
          <Text style={styles.buttonPrimaryText}>התחברות / הרשמה עם SubWallet</Text>
        </TouchableOpacity>

        {/* Sign in link */}
        <Pressable
          onPress={() => router.push('/wallet-login')}
          accessibilityRole="link"
          style={{ marginTop: 12 }}
        >
          <Text style={styles.signInText}>
            יש לך כבר חשבון? <Text style={styles.signInLink}>התחברי</Text>
          </Text>
        </Pressable>

        {/* Help: no wallet installed */}
        <Pressable onPress={() => setHelpVisible(true)} style={{ marginTop: 16 }}>
          <Text style={styles.helpText}>אין לך ארנק? צריך/ה עזרה בהתחברות</Text>
        </Pressable>

        {/* Modal: wallet help (SubWallet only) */}
        <Modal
          visible={helpVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setHelpVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>איך מתחברים עם SubWallet?</Text>

              <Text style={styles.modalBody}>
                 הורד את אפליקציית SubWallet. במסך הבא תוצג אפשרות לחתימה באמצעות QR/Deep Link.
              </Text>

              <View style={styles.linkList}>
                {/* Desktop extension */}
                <Pressable
                  onPress={() => Linking.openURL('https://www.subwallet.app')}
                  accessibilityRole="link"
                >
                  <Text style={styles.modalLink}>
                    הורדת SubWallet 
                  </Text>
                </Pressable>
                {/* Optional: דף הסבר */}
                <Pressable
                  onPress={() => Linking.openURL('https://support.subwallet.app')}
                  accessibilityRole="link"
                >
                  <Text style={styles.modalLink}>
                    מדריכים ותמיכה – SubWallet
                  </Text>
                </Pressable>

                {/* הצגת הערה לגבי פלטפורמה */}
                <Text style={styles.noteText}>
                  {Platform.OS === 'web'
                    ? 'טיפ: אם התוסף לא מזוהה, רענני את הדף לאחר ההתקנה.'
                    : 'טיפ: במובייל, המשך יתבצע באמצעות סריקת QR או פתיחה ישירה של SubWallet.'}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.buttonSecondary}
                onPress={() => setHelpVisible(false)}
              >
                <Text style={styles.buttonSecondaryText}>סגירה</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  logo: {
    width: 140,
    height: 140,
    marginBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textDim,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 18,
    lineHeight: 20,
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
    elevation: 2,
  },
  buttonPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  signInText: {
    color: COLORS.textDim,
    fontSize: 14,
  },
  signInLink: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  helpText: {
    color: COLORS.primary,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  modalBody: {
    fontSize: 14,
    color: COLORS.textDim,
    lineHeight: 20,
    textAlign: 'center',
  },
  linkList: {
    marginTop: 12,
    gap: 8,
  },
  modalLink: {
    fontSize: 15,
    color: COLORS.primary,
    textDecorationLine: 'underline',
    marginVertical: 4,
    textAlign: 'center',
  },
  noteText: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.textDim,
    textAlign: 'center',
  },
  buttonSecondary: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonSecondaryText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '700',
  },
});
