// app/lib/push.ts
import { Platform, Linking } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

const FALLBACK_PROJECT_ID = "ba9c100f-a0df-467a-ab24-8ed14b5a8ae6";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  const channelId = "default";
  await Notifications.setNotificationChannelAsync(channelId, {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export async function ensurePushSetup(): Promise<void> {
  if (!Device.isDevice) return;
  const before = await Notifications.getPermissionsAsync();
  let status = before.status;
  if (status !== "granted" && before.canAskAgain) {
    const req = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    status = req.status;
    if (status !== "granted") {
      try {
        await Linking.openSettings();
      } catch {}
    }
  }
  await ensureAndroidChannel();
}

function resolveProjectId(): string {
  const fromExtra = (Constants.expoConfig as any)?.extra?.eas?.projectId;
  const fromConstants = (Constants as any)?.easConfig?.projectId;
  return fromExtra ?? fromConstants ?? FALLBACK_PROJECT_ID;
}

function errToStr(e: any) {
  try {
    return JSON.stringify(e, Object.getOwnPropertyNames(e));
  } catch {
    return String(e);
  }
}

export async function getExpoTokenOrNull(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    const perms = await Notifications.getPermissionsAsync();
    if (perms.status !== "granted") return null;
    const projectId = resolveProjectId();
    const resp = await Notifications.getExpoPushTokenAsync({ projectId });
    return resp?.data ?? null;
  } catch {
    return null;
  }
}

export async function registerAndSyncPushToken(
  apiBaseUrl: string,
  jwt?: string
): Promise<string | null> {
  try {
    const expoToken = await getExpoTokenOrNull();
    if (!expoToken) return null;
    const resp = await fetch(`${apiBaseUrl}/devices/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify({
        provider: "expo",
        token: expoToken,
        platform: Platform.OS,
        channel_id: "default",
      }),
    });
    if (!resp.ok) return null;
    return expoToken;
  } catch {
    return null;
  }
}

/** 🔎 דוח דיאגנוסטיקה קצר לשימוש ב-Alert */
export async function getPushDebugReport(): Promise<string> {
  const lines: string[] = [];
  try {
    lines.push(`platform=${Platform.OS} isDevice=${String(Device.isDevice)}`);

    // Permissions
    const perms = await Notifications.getPermissionsAsync();
    lines.push(
      `perm.status=${perms.status} canAskAgain=${String(perms.canAskAgain)}`
    );

    // Project ID
    const pid = resolveProjectId();
    lines.push(`projectId=${pid}`);

    // Android channel
    if (Platform.OS === "android") {
      const ch = await Notifications.getNotificationChannelAsync("default");
      lines.push(`android.channel.default=${ch ? "exists" : "missing"}`);
    }

    // Try Expo token
    let expoToken = "";
    try {
      const resp = await Notifications.getExpoPushTokenAsync({
        projectId: pid,
      });
      expoToken = resp?.data ?? "";
      lines.push(`expoToken=${expoToken ? expoToken : "(none)"}`);
    } catch (e) {
      lines.push(`expoToken.error=${errToStr(e)}`);
    }

    // Device token (FCM/APNS) – דיאגנוסטיקה בלבד
    try {
      const dev = await Notifications.getDevicePushTokenAsync();
      lines.push(
        `deviceToken.type=${dev?.type ?? "(?)"} present=${dev?.data ? "yes" : "no"}`
      );
    } catch (e) {
      lines.push(`deviceToken.error=${errToStr(e)}`);
    }
  } catch (e) {
    lines.push(`fatal=${errToStr(e)}`);
  }
  return lines.join("\n");
}
