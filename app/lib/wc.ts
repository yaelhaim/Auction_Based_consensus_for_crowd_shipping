import SignClient from '@walletconnect/sign-client';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
//בדיקה  
console.log("WC ProjectId →", process.env.EXPO_PUBLIC_WC_PROJECT_ID);
console.log("API URL →", process.env.EXPO_PUBLIC_POBA_API);

// Polkadot (Relay chain) CAIP-2
const POLKADOT_CHAIN_ID = 'polkadot:91b171bb158e2d3848fa23a9f1c25182';

let _client: SignClient | null = null;

const WC_PROJECT_ID =
  process.env.EXPO_PUBLIC_WC_PROJECT_ID ??
  (Constants.expoConfig?.extra as any)?.wcProjectId;

if (!WC_PROJECT_ID) {
  throw new Error('חסר EXPO_PUBLIC_WC_PROJECT_ID (ProjectId מ-Reown)');
}
console.log('WC ProjectId →', WC_PROJECT_ID); // בדיקת טעינה

export async function getWCClient(): Promise<SignClient> {
  if (_client) return _client;

  _client = await SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name: 'BidDrop',
      description: 'Crowd-Shipping with Auction-Based Consensus',
      url: 'https://bidrop.app',
      icons: [
        'https://raw.githubusercontent.com/yaelhaim/Auction_Based_consensus_for_crowd_shipping/main/assets/images/icon.png',
      ],
    },
  });

  return _client;
}

// טיפוס עזר ל-session שנחזיר
export type WCSessionInfo = {
  topic: string;
  address: string; // כתובת Substrate
  raw: any;        // ה-session המלא
};

// יצירת session ופתיחת הארנק
export async function connect(): Promise<WCSessionInfo> {
  const client = await getWCClient();

  const requiredNamespaces = {
    polkadot: {
      methods: ['polkadot_signMessage'],
      chains: [POLKADOT_CHAIN_ID],
      events: [],
    },
  };

  const { uri, approval } = await client.connect({ requiredNamespaces });

  // אם קיבלנו URI — פותחים את הארנק (SubWallet יודע לקלוט wc:)
  if (uri) {
    const deeplink = `subwallet://wc?uri=${encodeURIComponent(uri)}`;
    try {
      await Linking.openURL(deeplink);
    } catch {
      // fallback: תנסי לפתוח ישירות את ה-wc uri אם אין אפליקציה
      await Linking.openURL(uri);
    }
  }

  // המתנה לאישור מהארנק
  const session = await approval();

  // כתובת מה-namespaces (פורמט "polkadot:<chainId>:<address>")
  const accounts: string[] = session.namespaces.polkadot?.accounts || [];
  if (!accounts.length) {
    throw new Error('לא התקבלו חשבונות מהארנק');
  }
  const [_, __, address] = accounts[0].split(':');

  return { topic: session.topic, address, raw: session };
}

// בקשת חתימה על הודעה דרך WalletConnect
export async function signMessage(topic: string, address: string, message: string): Promise<string> {
  const client = await getWCClient();

  const result = await client.request({
    topic,
    chainId: POLKADOT_CHAIN_ID,
    request: {
      method: 'polkadot_signMessage',
      params: { address, message },
    },
  });

  if (typeof result !== 'string') {
    throw new Error('התקבלה תשובת חתימה לא צפויה מהארנק');
  }
  return result;
}
