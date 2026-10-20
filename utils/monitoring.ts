import type { ComponentType } from 'react';
import * as Sentry from '@sentry/react-native';

// Crash + performance monitoring (HLD §7). Disabled unless a DSN is provided at
// build time (EXPO_PUBLIC_SENTRY_DSN), so local and test builds report nothing.
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

// PostgREST URLs carry filters such as `?email=eq.driver@example.com`; keep only
// the path so emails and ids in query strings never leave the device.
const stripQuery = (url: unknown) => (typeof url === 'string' ? url.split('?')[0] : url);

export const initMonitoring = () => {
  if (!dsn) return;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0.2,
    environment: __DEV__ ? 'development' : 'production',
    beforeBreadcrumb(crumb) {
      if ((crumb.category === 'fetch' || crumb.category === 'xhr') && crumb.data) {
        crumb.data = { ...crumb.data, url: stripQuery(crumb.data.url) };
      }
      return crumb;
    },
    beforeSend(event) {
      if (event.request?.url) event.request.url = stripQuery(event.request.url) as string;
      if (event.user) event.user = { id: event.user.id };
      return event;
    },
  });
};

// Identify the signed-in user by id only (no email), so crashes can be grouped per user.
export const setMonitoringUser = (userId: string | null) => {
  if (!dsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
};

// Sentry.wrap warns at startup when Sentry.init never ran, so only wrap with a DSN.
export const wrapRoot = <P extends Record<string, any>>(Root: ComponentType<P>) =>
  dsn ? Sentry.wrap(Root) : Root;
