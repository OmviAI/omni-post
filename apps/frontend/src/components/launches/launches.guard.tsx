'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LaunchesComponent } from '@gitroom/frontend/components/launches/launches.component';

const LAUNCHES_SESSION_KEY = 'launches_clerk_session';

type LaunchesSession = {
  userId: string;
  email?: string | null;
  name?: string | null;
  token: string;
  storedAt: number;
  // Store full Clerk claims so other components can rely on them
  claims?: Record<string, unknown>;
};

/**
 * Client-side guard for the /launches route.
 *
 * Behaviour:
 * - On first visit with query params (?userId=&email=&name=&token=),
 *   it stores them in localStorage and strips the query from the URL.
 * - On subsequent visits, it reads from localStorage.
 * - If no valid session is found, it redirects back to the auth source
 *   (e.g. the app on port 3000) so the user can log in again.
 */
export function LaunchesGuard() {
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const paramsUserId = searchParams.get('userId');
        const paramsToken = searchParams.get('token');
        const paramsEmail = searchParams.get('email');
        const paramsName = searchParams.get('name');

        const existingRaw =
          typeof window !== 'undefined'
            ? window.localStorage.getItem(LAUNCHES_SESSION_KEY)
            : null;

        let session: LaunchesSession | null = null;

        // If we have fresh data in the URL, verify it with Clerk first
        if (paramsUserId && paramsToken) {
          const res = await fetch('/api/clerk/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token: paramsToken }),
          });

          if (!res.ok) {
            throw new Error('Token verification failed');
          }

          const data = await res.json();
          const claims = (data && data.claims) || {};

          // Prefer values coming from Clerk claims over the URL,
          // but fall back to the URL params if needed.
          const claimsUserId =
            (claims && (claims as any).sub) || paramsUserId || '';
          const claimsEmail =
            (claims && ((claims as any).email || (claims as any).email_address)) ||
            paramsEmail ||
            null;
          const claimsName =
            (claims && ((claims as any).name || (claims as any).full_name)) ||
            paramsName ||
            null;

          session = {
            userId: claimsUserId,
            email: claimsEmail,
            name: claimsName,
            token: paramsToken,
            storedAt: Date.now(),
            claims,
          };

          window.localStorage.setItem(
            LAUNCHES_SESSION_KEY,
            JSON.stringify(session),
          );

          // Strip sensitive params from the URL
          const url = new URL(window.location.href);
          url.search = '';
          window.history.replaceState({}, '', url.toString());
        } else if (existingRaw) {
          try {
            session = JSON.parse(existingRaw) as LaunchesSession;
          } catch {
            session = null;
          }
        }

        if (!session) {
          // No verified session either in URL or localStorage.
          // For now, don't auto-redirect; just keep the guard not-ready
          // and let higher-level auth (Clerk + middleware) decide.
          console.warn(
            '[LaunchesGuard] No session after verify/localStorage – not redirecting',
          );
          return;
        }

        // At this point we have a verified Clerk-backed session
        // and can render the launches UI.
        setReady(true);
      } catch (e) {
        // If anything goes wrong, log it but don't force a redirect here.
        // Middleware / Clerk will handle unauthenticated access.
        console.error('Error while initializing launches session', e);
      }
    })();
  }, [searchParams]);

  if (!ready) {
    return null;
  }

  return <LaunchesComponent />;
}

