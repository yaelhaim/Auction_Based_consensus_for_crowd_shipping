// app/lib/wc.ts
import SignClient from "@walletconnect/sign-client";
import * as Linking from "expo-linking";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";

const POLKADOT_CHAIN_ID = "polkadot:91b171bb158e2d3848fa23a9f1c25182";
const PLAY_PACKAGE = "app.subwallet.mobile";

let _client: SignClient | null = null;

const WC_PROJECT_ID =
  process.env.EXPO_PUBLIC_WC_PROJECT_ID ??
  (Constants.expoConfig?.extra as any)?.wcProjectId;
if (!WC_PROJECT_ID) {
  throw new Error(
    "Missing EXPO_PUBLIC_WC_PROJECT_ID (WalletConnect ProjectId)"
  );
}

function normalizeSignature(res: any): string {
  const sig = (res &&
    (res.signature ?? res.result ?? res.signed ?? res)) as any;
  if (typeof sig !== "string")
    throw new Error("Unexpected signature result from wallet");
  return sig.startsWith("0x") ? sig : `0x${sig}`;
}

export type WCSessionInfo = { topic: string; address: string; raw: any };
export type WCConnectResult =
  | { type: "approved"; session: WCSessionInfo }
  | {
      type: "needsWallet";
      uri: string;
      waitForApproval: () => Promise<WCSessionInfo>;
    };

export async function getWCClient(): Promise<SignClient> {
  if (_client) return _client;
  _client = await SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name: "BidDrop",
      description: "Crowd-Shipping with Auction-Based Consensus",
      url: "https://bidrop.app",
      icons: [
        "https://raw.githubusercontent.com/yaelhaim/Auction_Based_consensus_for_crowd_shipping/main/assets/images/icon.png",
      ],
    },
  });
  return _client;
}

export async function connect(): Promise<WCConnectResult> {
  const client = await getWCClient();

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      polkadot: {
        // Keep ONLY signMessage to avoid "Unsupported methods: polkadot_signRaw"
        methods: ["polkadot_signMessage"],
        chains: [POLKADOT_CHAIN_ID],
        events: [],
      },
    },
  });

  const resolveSession = async () => {
    const s = await approval();
    const acct = s.namespaces.polkadot.accounts[0] as string; // "polkadot:<chainId>:<address>"
    const address = acct.split(":")[2];
    return { topic: s.topic, address, raw: s };
  };

  if (!uri) return { type: "approved", session: await resolveSession() };

  if (!Device.isDevice) {
    return { type: "needsWallet", uri, waitForApproval: resolveSession };
  }

  const baseScheme = "subwallet://";
  const deeplink = `subwallet://wc?uri=${encodeURIComponent(uri)}`;
  const universal = `https://link.subwallet.app/wc?uri=${encodeURIComponent(
    uri
  )}`;

  try {
    const canOpen = await Linking.canOpenURL(baseScheme);
    if (canOpen) {
      await Linking.openURL(deeplink);
    } else if (Platform.OS === "android") {
      const market = `market://details?id=${PLAY_PACKAGE}`;
      const httpsPlay = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;
      try {
        await Linking.openURL(market);
      } catch {
        await Linking.openURL(httpsPlay);
      }
    } else {
      await Linking.openURL(universal);
    }
  } catch {
    await Linking.openURL(uri); // last resort
  }

  return { type: "approved", session: await resolveSession() };
}

export async function signMessage(
  topic: string,
  address: string,
  message: string
): Promise<string> {
  const client = await getWCClient();
  const res = await client.request({
    topic,
    chainId: POLKADOT_CHAIN_ID,
    request: {
      method: "polkadot_signMessage",
      params: { address, message }, // plain string message (exact server string)
    },
  });
  return normalizeSignature(res);
}
