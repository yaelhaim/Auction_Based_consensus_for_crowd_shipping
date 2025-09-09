// WalletConnect helper with mobile deep linking + return-to-app:
// - Prefer opening the WalletConnect "wc:" URI directly (most reliable).
// - On Android, target SubWallet package explicitly via expo-intent-launcher.
// - Append redirectUrl to deep links that support it so wallet can bounce back.
// - If the app isn't installed, fall back to the store.
// - QR fallback is still returned to the UI.

import SignClient from "@walletconnect/sign-client";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { Platform } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";

const POLKADOT_CHAIN_ID = "polkadot:91b171bb158e2d3848fa23a9f1c25182";

// Official store identifiers (do not localize)
const PLAY_PACKAGE = "app.subwallet.mobile";
const PLAY_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;
const APPSTORE_URL = "https://apps.apple.com/app/id1633050285";

let _client: SignClient | null = null;

const WC_PROJECT_ID =
  process.env.EXPO_PUBLIC_WC_PROJECT_ID ??
  (Constants.expoConfig?.extra as any)?.wcProjectId;

if (!WC_PROJECT_ID) {
  throw new Error(
    "Missing EXPO_PUBLIC_WC_PROJECT_ID (WalletConnect ProjectId)"
  );
}

// Build a return URL that wallets can bounce back to (requires app.json "scheme")
export function getReturnUrl(): string {
  // Example: biddrop://wc-callback
  return Linking.createURL("wc-callback");
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

/**
 * Try to open SubWallet app if installed, passing the WC URI.
 * If the app is not available, open the appropriate store page.
 * BEST-EFFORT: resolves to a hint string and never throws.
 */
export async function openSubWalletOrStore(
  wcUri?: string
): Promise<"opened" | "store" | "noop"> {
  try {
    if (__DEV__) console.log("WalletConnect URI:", wcUri);
    const redirect = encodeURIComponent(getReturnUrl());

    if (Platform.OS === "android") {
      // 1) Strongest: open the "wc:" URI explicitly with SubWallet package
      if (wcUri && wcUri.startsWith("wc:")) {
        try {
          await IntentLauncher.startActivityAsync(
            "android.intent.action.VIEW",
            {
              data: wcUri,
              packageName: PLAY_PACKAGE,
              category: "android.intent.category.BROWSABLE",
              flags: 0,
            }
          );
          return "opened";
        } catch (e) {
          if (__DEV__) console.warn("Intent to SubWallet failed →", e);
        }
      }

      // 2) Android intent deep link (adds redirectUrl)
      if (wcUri) {
        const enc = encodeURIComponent(wcUri);
        const intentUrl = `intent://wc?uri=${enc}&redirectUrl=${redirect}#Intent;scheme=subwallet;package=${PLAY_PACKAGE};end`;
        try {
          await Linking.openURL(intentUrl);
          return "opened";
        } catch {}
      }

      // 3) subwallet:// scheme (adds redirectUrl)
      if (wcUri) {
        const enc = encodeURIComponent(wcUri);
        const subUrl = `subwallet://wc?uri=${enc}&redirectUrl=${redirect}`;
        try {
          await Linking.openURL(subUrl);
          return "opened";
        } catch {}
      }

      // 4) Generic: any wallet that handles "wc:"
      if (wcUri && wcUri.startsWith("wc:")) {
        try {
          await Linking.openURL(wcUri);
          return "opened";
        } catch {}
      }

      // 5) Store
      await Linking.openURL(PLAY_URL);
      return "store";
    } else {
      // iOS: try wc: → subwallet:// → universal (with redirectUrl) → App Store
      if (wcUri && wcUri.startsWith("wc:")) {
        try {
          await Linking.openURL(wcUri);
          return "opened";
        } catch {}
      }
      if (wcUri) {
        const enc = encodeURIComponent(wcUri);
        try {
          await Linking.openURL(
            `subwallet://wc?uri=${enc}&redirectUrl=${redirect}`
          );
          return "opened";
        } catch {}
        try {
          await Linking.openURL(
            `https://wallet.subwallet.app/wc?uri=${enc}&redirectUrl=${redirect}`
          );
          return "opened";
        } catch {}
      }
      await Linking.openURL(APPSTORE_URL);
      return "store";
    }
  } catch {
    return "noop";
  }
}

export async function connect(): Promise<WCConnectResult> {
  const client = await getWCClient();

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      polkadot: {
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
  return { type: "needsWallet", uri, waitForApproval: resolveSession };
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
      params: { address, message }, // exact server string
    },
  });
  return normalizeSignature(res);
}
