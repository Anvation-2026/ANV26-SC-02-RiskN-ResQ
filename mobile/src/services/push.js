// Registers this phone for push notifications and tells the backend. Native only, best effort: if the user declines or
// the build cannot receive push (for example Expo Go), the app simply works without it.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { http } from './api';

let registered = null;

export async function registerForPush() {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('alerts', { name: 'Flood alerts', importance: Notifications.AndroidImportance.MAX });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await http('/me/push-token', { method: 'POST', body: { token: data, platform: Platform.OS } });
    registered = data;
    return data;
  } catch (e) {
    return null; // no push in this build; nothing else depends on it
  }
}

export const getRegisteredPushToken = () => registered;

export async function unregisterPush() {
  if (!registered) return;
  try { await http('/me/push-token', { method: 'DELETE', body: { token: registered } }); } catch (e) { /* ignore */ }
  registered = null;
}
