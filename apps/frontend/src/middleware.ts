import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import acceptLanguage from 'accept-language';
import {
  cookieName,
  fallbackLng,
  headerName,
  languages,
} from '@gitroom/react/translation/i18n.config';
acceptLanguage.languages(languages);

// This function can be marked `async` if using `await` inside
export async function middleware(request: NextRequest) {
  const nextUrl = request.nextUrl;
  const authCookie =
    request.cookies.get('auth') ||
    request.headers.get('auth') ||
    nextUrl.searchParams.get('loggedAuth');

  const lng = request.cookies.has(cookieName)
    ? acceptLanguage.get(request.cookies.get(cookieName).value)
    : acceptLanguage.get(
      request.headers.get('Accept-Language') ||
      request.headers.get('accept-language')
    );

  const topResponse = NextResponse.next();

  if (lng) {
    topResponse.headers.set(cookieName, lng);
  }

  // Skip middleware for static files
  if (
    nextUrl.pathname.startsWith('/uploads/') ||
    nextUrl.pathname.startsWith('/p/') ||
    nextUrl.pathname.startsWith('/icons/') ||
    nextUrl.pathname.startsWith('/_next/') ||
    nextUrl.pathname.startsWith('/api/')
  ) {
    return topResponse;
  }

  // Modal requires auth
  if (nextUrl.pathname.startsWith('/modal/') && !authCookie) {
    return NextResponse.redirect(new URL(`/auth/login-required`, request.url));
  }

  // Logout
  if (nextUrl.pathname.startsWith('/auth/logout')) {
    const response = NextResponse.redirect(new URL('/auth/login', request.url));
    response.cookies.set('auth', '', {
      path: '/',
      ...(!process.env.NOT_SECURED
        ? {
          secure: true,
          httpOnly: true,
          sameSite: 'lax', // Changed from false
        }
        : {}),
      maxAge: -1,
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
    });
    return response;
  }

  const org = nextUrl.searchParams.get('org');

  // Not authenticated and not on auth page
  if (!nextUrl.pathname.startsWith('/auth') && !authCookie) {
    const providers = ['google', 'settings'];
    const findIndex = providers.find((p) => nextUrl.href.indexOf(p) > -1);
    const url = nextUrl.clone();
    url.pathname = '/auth';

    if (findIndex) {
      const providerName = findIndex === 'settings'
        ? (process.env.POSTIZ_GENERIC_OAUTH ? 'generic' : 'github')
        : findIndex;
      url.searchParams.set('provider', providerName.toUpperCase());
    }

    return NextResponse.redirect(url);
  }

  // Authenticated but on auth page
  if (nextUrl.pathname.startsWith('/auth') && authCookie) {
    const url = nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // Handle org parameter for non-authenticated users
  if (nextUrl.pathname.startsWith('/auth') && !authCookie && org) {
    const redirect = NextResponse.redirect(new URL('/', request.url));
    redirect.cookies.set('org', org, {
      ...(!process.env.NOT_SECURED
        ? {
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
          domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        }
        : {}),
      expires: new Date(Date.now() + 15 * 60 * 1000),
    });
    return redirect;
  }

  try {
    // Handle org joining for authenticated users
    if (org && authCookie) {
      const { id } = await (
        await internalFetch('/user/join-org', {
          body: JSON.stringify({ org }),
          method: 'POST',
        })
      ).json();

      const url = nextUrl.clone();
      url.pathname = '/';
      url.searchParams.set('added', 'true');
      url.searchParams.delete('org');

      const redirect = NextResponse.redirect(url);
      if (id) {
        redirect.cookies.set('showorg', id, {
          ...(!process.env.NOT_SECURED
            ? {
              path: '/',
              secure: true,
              httpOnly: true,
              sameSite: 'lax',
              domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
            }
            : {}),
          expires: new Date(Date.now() + 15 * 60 * 1000),
        });
      }
      return redirect;
    }

    // Redirect root to appropriate dashboard
    if (nextUrl.pathname === '/') {
      const url = nextUrl.clone();
      url.pathname = !!process.env.IS_GENERAL ? '/launches' : '/analytics';
      return NextResponse.redirect(url);
    }

    return topResponse;
  } catch (err) {
    console.log('Middleware error:', err);
    return NextResponse.redirect(new URL('/auth/logout', request.url));
  }
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: '/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)',
};
