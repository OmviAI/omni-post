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

        // If we have fresh data in the URL, exchange Clerk token for our own JWT session
        if (paramsUserId && paramsToken) {
          const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || '';
          
          try {
            const res = await fetch(`${backendUrl}/auth/clerk-session`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              credentials: 'include', // Important: include cookies
              body: JSON.stringify({ token: paramsToken }),
            });

            if (!res.ok) {
              const errorData = await res.json().catch(() => ({}));
              
              // If token expired, redirect to sign-in immediately
              if (errorData.expired || errorData.error?.includes('expired')) {
                console.warn(
                  '[LaunchesGuard] Clerk token expired – redirecting to sign-in',
                );
                const signInPath =
                  process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || '/sign-in';
                window.location.href = signInPath;
                return;
              }
              
              console.error('[LaunchesGuard] Token exchange failed:', errorData);
              throw new Error(
                errorData.error || `Token exchange failed: ${res.status}`,
              );
            }

            const data = await res.json();

            if (!data.success) {
              console.error('[LaunchesGuard] Token exchange returned success=false');
              throw new Error('Failed to create session');
            }

            // After successful exchange, we now have a JWT cookie set by the backend.
            // The cookie is httpOnly, so we can't check it via document.cookie,
            // but we trust that if the exchange succeeded, the cookie was set.
            // Clear any old Clerk token from localStorage
            window.localStorage.removeItem(LAUNCHES_SESSION_KEY);

            // Fetch full user data from /user/self to ensure organization and other data is loaded
            // This ensures the UI has all necessary user details (orgId, tier, etc.)
            try {
              const userRes = await fetch(`${backendUrl}/user/self`, {
                method: 'GET',
                credentials: 'include', // Include the JWT cookie
              });

              if (userRes.ok) {
                const userData = await userRes.json();
                console.log('[LaunchesGuard] User data loaded:', {
                  userId: userData.id,
                  orgId: userData.orgId,
                  tier: userData.tier,
                });
              } else {
                console.warn('[LaunchesGuard] Failed to load user data:', userRes.status);
              }
            } catch (error) {
              console.error('[LaunchesGuard] Error loading user data:', error);
              // Don't block rendering if user data fetch fails - it will retry in layout component
            }

            // Strip sensitive params from the URL
            const url = new URL(window.location.href);
            url.search = '';
            window.history.replaceState({}, '', url.toString());

            // Session is now managed by the JWT cookie, not localStorage
            console.log('[LaunchesGuard] Token exchange successful, session established');
            setReady(true);
            return;
          } catch (error) {
            console.error('[LaunchesGuard] Error during token exchange:', error);
            // If exchange fails, redirect to sign-in
            const signInPath =
              process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || '/sign-in';
            window.location.href = signInPath;
            return;
          }
        } else if (existingRaw) {
          // Legacy: if there's an old Clerk token in localStorage, try to exchange it
          try {
            const oldSession = JSON.parse(existingRaw) as LaunchesSession;
            if (oldSession.token) {
              // Try to exchange the old token for a new JWT session
              const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || '';
              const res = await fetch(`${backendUrl}/auth/clerk-session`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({ token: oldSession.token }),
              });

              if (res.ok) {
                // Successfully exchanged, remove old token
                window.localStorage.removeItem(LAUNCHES_SESSION_KEY);
                setReady(true);
                return;
              }
            }
          } catch {
            // If exchange fails, clear the old token and continue
            window.localStorage.removeItem(LAUNCHES_SESSION_KEY);
          }
        }

        // At this point, we're checking if there's an existing JWT session.
        // Since httpOnly cookies aren't accessible via document.cookie,
        // we'll make a lightweight API call to verify the session is valid.
        // If the user previously exchanged a token, the cookie should be set.
        try {
          const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || '';
          // Use a lightweight endpoint to check if session is valid
          // Try /integrations/list as it requires auth and is fast
          const testRes = await fetch(`${backendUrl}/integrations/list`, {
            method: 'GET',
            credentials: 'include', // Include cookies
          });

          if (testRes.ok || testRes.status === 200) {
            // Session is valid, user is authenticated
            console.log('[LaunchesGuard] Existing JWT session is valid');
            setReady(true);
            return;
          } else if (testRes.status === 401 || testRes.status === 403) {
            // Session is invalid or expired
            console.warn('[LaunchesGuard] Session check returned 401/403');
          }
        } catch (error) {
          console.error('[LaunchesGuard] Error checking session:', error);
        }

        // No valid session found. Redirect to Clerk sign-in.
        console.warn(
          '[LaunchesGuard] No valid JWT session found – redirecting to sign-in',
        );
        const signInPath =
          process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || '/sign-in';
        window.location.href = signInPath;
        return;
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

