import type { NotificationSettings } from '../../../../shared/schema';
import { api } from '../../api/client';

export type { NotificationSettings } from '../../../../shared/schema';

export async function fetchNotificationSettings(): Promise<NotificationSettings | null> {
  const response = await api.api.settings.notifications.$get();
  if (!response.ok) return null;
  return await response.json() as NotificationSettings;
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<boolean> {
  const response = await api.api.settings.notifications.$put({ json: settings });
  return response.ok;
}
