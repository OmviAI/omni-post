'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LaunchesComponent } from '@gitroom/frontend/components/launches/launches.component';

const LAUNCHES_SESSION_KEY = 'launches_clerk_session';

// Fallback cookie setter (non-httpOnly) used when cross-domain httpOnly cookies can't be set.
// The app's custom fetch wrapper can forward this cookie value as an `auth` header.
function setClientCookie(name: string, value: string, days: number) {
  if (typeof document === 'undefined') return;
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = 'expires=' + d.toUTCString();
  document.cookie = `${name}=${value};${expires};path=/`;
}

function getClientCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

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
 * - On first visit with query params (?userId=&token=, optional: email, name),
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

        const existingRaw =
          typeof window !== 'undefined'
            ? window.localStorage.getItem(LAUNCHES_SESSION_KEY)
            : null;

        let session: LaunchesSession | null = null;

        // If we have fresh data in the URL, exchange Clerk token for our own JWT session
        if (paramsUserId && paramsToken) {
          const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || '';
          
          try {
            // IMPORTANT:
            // If the user is already logged in (old auth cookie), and they open a /launches link
            // with a NEW Clerk token, we must clear the previous backend session first.
            // Otherwise the browser can keep sending the old cookie and downstream list APIs may 401.
            try {
              await fetch(`${backendUrl}/user/logout`, {
                method: 'POST',
                credentials: 'include',
              });
            } catch (e) {
              // Don't block token exchange if logout fails (cookie may already be absent).
              console.warn('[LaunchesGuard] Pre-exchange logout failed (continuing):', e);
            }

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

            // If the browser blocks Set-Cookie (common when backend/frontend are on different eTLD+1),
            // persist JWT + org from response headers as a non-httpOnly cookie fallback.
            // This matches what `LayoutContext` does in its `afterRequest` handler, but this guard
            // uses raw fetch so we must handle it here too.
            const headerAuth = res.headers.get('auth') || res.headers.get('Auth');
            const headerShowOrg =
              res.headers.get('showorg') || res.headers.get('Showorg');
            if (headerAuth) setClientCookie('auth', headerAuth, 365);
            if (headerShowOrg) setClientCookie('showorg', headerShowOrg, 365);

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
                headers: {
                  ...(headerAuth ? { auth: headerAuth } : {}),
                  ...(headerShowOrg ? { showorg: headerShowOrg } : {}),
                },
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
            // Set ready to true so the component renders
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
          const fallbackAuth = getClientCookie('auth');
          const fallbackShowOrg = getClientCookie('showorg');
          const testRes = await fetch(`${backendUrl}/integrations/list`, {
            method: 'GET',
            headers: {
              ...(fallbackAuth ? { auth: fallbackAuth } : {}),
              ...(fallbackShowOrg ? { showorg: fallbackShowOrg } : {}),
            },
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

