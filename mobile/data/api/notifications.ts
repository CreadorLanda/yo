import { Platform } from 'react-native';

import { api } from './client';

export type NotifPlatform = 'ios' | 'android' | 'web' | 'unknown';

export interface NotifPrefs {
  user_id: string;
  messages: boolean;
  groups: boolean;
  calls: boolean;
  stories: boolean;
}

export interface PushDevice {
  id: string;
  user_id: string;
  device_id: string;
  platform: NotifPlatform;
  token: string;
  created_at: string;
  updated_at: string;
}

export function getNotifPrefs() {
  return api.get<NotifPrefs>('/api/notifications/prefs');
}

export function patchNotifPrefs(patch: {
  messages?: boolean;
  groups?: boolean;
  calls?: boolean;
  stories?: boolean;
}) {
  return api.patch<NotifPrefs>('/api/notifications/prefs', patch);
}

export function registerPushDevice(token: string, platform?: NotifPlatform) {
  const plat: NotifPlatform =
    platform ??
    (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'unknown');
  return api.put<PushDevice>('/api/notifications/devices', {
    token,
    platform: plat,
  });
}

export function unregisterPushDevice() {
  return api.del<void>('/api/notifications/devices');
}

export function testPush() {
  return api.post<{ queued: boolean }>('/api/notifications/test');
}

export function apiSaveOnboardingChoices(data: { contacts_visible: boolean }) {
  return api.post<{ success: boolean }>('/api/users/onboarding/preferences', data);
}

export function apiLoadOnboardingChoices() {
  return api.get<{ contacts_visible: boolean }>('/api/users/onboarding/preferences');
}
