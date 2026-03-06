'use client';

import React, { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { Plus_Jakarta_Sans } from 'next/font/google';
const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  {
    ssr: false,
  }
);

import clsx from 'clsx';
import dynamic from 'next/dynamic';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { usePathname, useSearchParams } from 'next/navigation';
import { CheckPayment } from '@gitroom/frontend/components/layout/check.payment';
import { ToolTip } from '@gitroom/frontend/components/layout/top.tip';
import { ShowMediaBoxModal } from '@gitroom/frontend/components/media/media.component';
import { ShowLinkedinCompany } from '@gitroom/frontend/components/launches/helpers/linkedin.component';
import { MediaSettingsLayout } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { ShowPostSelector } from '@gitroom/frontend/components/post-url-selector/post.url.selector';
import { NewSubscription } from '@gitroom/frontend/components/layout/new.subscription';
import { Support } from '@gitroom/frontend/components/layout/support';
import { ContinueProvider } from '@gitroom/frontend/components/layout/continue.provider';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { CopilotKit } from '@copilotkit/react-core';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Impersonate } from '@gitroom/frontend/components/layout/impersonate';
import { Title } from '@gitroom/frontend/components/layout/title';
import { TopMenu } from '@gitroom/frontend/components/layout/top.menu';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';
import { ChromeExtensionComponent } from '@gitroom/frontend/components/layout/chrome.extension.component';
import NotificationComponent from '@gitroom/frontend/components/notifications/notification.component';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import { PreConditionComponent } from '@gitroom/frontend/components/layout/pre-condition.component';
import { AttachToFeedbackIcon } from '@gitroom/frontend/components/new-layout/sentry.feedback.component';
import { FirstBillingComponent } from '@gitroom/frontend/components/billing/first.billing.component';
import { useUser as useClerkUser } from '@clerk/nextjs';

const jakartaSans = Plus_Jakarta_Sans({
  weight: ['600', '500', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
});

const LAUNCHES_SESSION_KEY = 'launches_clerk_session';

type LaunchesSession = {
  userId: string;
  email?: string | null;
  name?: string | null;
  token: string;
  storedAt: number;
  claims?: Record<string, unknown>;
};

export const LayoutComponent = ({ children }: { children: ReactNode }) => {
  const { backendUrl, billingEnabled, isGeneral } = useVariables();
  const pathname = usePathname();

  // Feedback icon component attaches Sentry feedback to a top-bar icon when DSN is present
  const searchParams = useSearchParams();

  // Load full user data from backend after Clerk authentication
  // This provides orgId, tier, totalChannels, and other app-specific data
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error('[LayoutComponent] Error loading user data:', error);
      return null;
    }
  }, [fetch]);
  
  // Only fetch /user/self if we have a JWT cookie (authenticated via Clerk)
  // Check for auth cookie to determine if we should fetch
  const [hasAuthCookie, setHasAuthCookie] = useState(false);
  useEffect(() => {
    const checkCookie = () => {
      if (typeof document !== 'undefined') {
        const cookie = document.cookie.split(';').find(c => c.trim().startsWith('auth='));
        const hasCookie = !!cookie;
        setHasAuthCookie(hasCookie);
        return hasCookie;
      }
      return false;
    };
    
    // Check immediately
    checkCookie();
    
    // Also check periodically (in case cookie is set after mount, e.g., after token exchange)
    const interval = setInterval(() => {
      checkCookie();
    }, 1000);
    
    // Check when pathname changes (e.g., after redirect from token exchange)
    if (pathname) {
      checkCookie();
    }
    
    return () => clearInterval(interval);
  }, [pathname]);
  
  const { data: backendUser, mutate } = useSWR(
    hasAuthCookie ? '/user/self' : null,
    load,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      refreshWhenOffline: false,
      refreshWhenHidden: false,
      // Revalidate when the key changes (i.e., when hasAuthCookie becomes true)
      revalidateOnMount: true,
    }
  );

  const { isLoaded, isSignedIn, user: clerkUser } = useClerkUser();
  const [launchesSession, setLaunchesSession] = useState<LaunchesSession | null>(
    null,
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAUNCHES_SESSION_KEY);
      if (!raw) return;
      setLaunchesSession(JSON.parse(raw) as LaunchesSession);
    } catch {
      setLaunchesSession(null);
    }
  }, []);

  const user = useMemo(() => {
    // Prefer backend user data (from /user/self) when available - it has all the app-specific fields
    if (backendUser) {
      return backendUser;
    }

    // Fallback: use Clerk user data with defaults
    if (isSignedIn && clerkUser) {
      return {
        id: clerkUser.id,
        name: clerkUser.fullName || clerkUser.firstName || 'User',
        email:
          clerkUser.primaryEmailAddress?.emailAddress ||
          clerkUser.emailAddresses?.[0]?.emailAddress ||
          '',

        // App-specific fields defaulted (will be updated when /user/self loads)
        orgId: '',
        tier: 'FREE' as const,
        role: 'USER' as const,
        publicApi: '',
        totalChannels: 0,

        // Convenience flags used throughout UI
        admin: false,
        isLifetime: false,
        impersonate: false,
        allowTrial: false,
        isTrailing: false,
      };
    }

    // Fallback: use the verified launches session (stored by LaunchesGuard)
    if (launchesSession?.userId) {
      return {
        id: launchesSession.userId,
        name: launchesSession.name || 'User',
        email: launchesSession.email || '',
        orgId: '',
        tier: 'FREE' as const,
        role: 'USER' as const,
        publicApi: '',
        totalChannels: 0,
        admin: false,
        isLifetime: false,
        impersonate: false,
        allowTrial: false,
        isTrailing: false,
      };
    }

    return null;
  }, [backendUser, clerkUser, isSignedIn, launchesSession?.email, launchesSession?.name, launchesSession?.userId]);

  // For /launches, provide a minimal layout structure without requiring full user data
  // The LaunchesGuard handles authentication, so we just need the wrapper providers
  if (pathname.startsWith('/launches')) {
    // Create a minimal user object for /launches to satisfy ContextWrapper
    const minimalUser = user || {
      id: 'temp',
      name: 'User',
      email: '',
      orgId: '',
      tier: 'FREE' as const,
      role: 'USER' as const,
      publicApi: '',
      totalChannels: 0,
      admin: false,
      isLifetime: false,
      impersonate: false,
      allowTrial: false,
      isTrailing: false,
    };

    return (
      <ContextWrapper user={minimalUser as any}>
        <CopilotKit
          credentials="include"
          runtimeUrl={backendUrl + '/copilot/chat'}
          showDevConsole={false}
        >
          <MantineWrapper>
            <ToolTip />
            <Toaster />
            <ShowMediaBoxModal />
            <ShowLinkedinCompany />
            <MediaSettingsLayout />
            <ShowPostSelector />
            <div
              className={clsx(
                'flex flex-col min-h-screen min-w-screen text-newTextColor p-[12px]',
                jakartaSans.className
              )}
            >
              <div className="flex flex-1 gap-[8px]">
                <Support />
                <div className="flex flex-col bg-newBgColorInner w-[80px] rounded-[12px]">
                  <div className="fixed h-full w-[64px] start-[17px] flex flex-1 top-0">
                    <div className="flex flex-col h-full gap-[32px] flex-1 py-[12px]">
                      <Logo />
                      <TopMenu />
                    </div>
                  </div>
                </div>
                <div className="flex-1 bg-newBgLineColor rounded-[12px] overflow-hidden flex flex-col gap-[1px] blurMe">
                  <div className="flex bg-newBgColorInner h-[80px] px-[20px] items-center">
                    <div className="text-[24px] font-[600] flex flex-1">
                      <Title />
                    </div>
                    <div className="flex gap-[20px] text-textItemBlur">
                      <OrganizationSelector />
                      <div className="hover:text-newTextColor">
                        <ModeComponent />
                      </div>
                      <div className="w-[1px] h-[20px] bg-blockSeparator" />
                      <LanguageComponent />
                      <ChromeExtensionComponent />
                      <div className="w-[1px] h-[20px] bg-blockSeparator" />
                      <AttachToFeedbackIcon />
                      <NotificationComponent />
                    </div>
                  </div>
                  <div className="flex flex-1 gap-[1px] min-h-0">{children}</div>
                </div>
              </div>
            </div>
          </MantineWrapper>
        </CopilotKit>
      </ContextWrapper>
    );
  }

  // If Clerk is loaded and user is not signed in, send to Clerk sign-in
  if (isLoaded && !user) {
    window.location.href =
      process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || '/sign-in';
    return null;
  }

  return (
    <ContextWrapper user={user as any}>
      <CopilotKit
        credentials="include"
        runtimeUrl={backendUrl + '/copilot/chat'}
        showDevConsole={false}
      >
        <MantineWrapper>
          <ToolTip />
          <Toaster />
          <CheckPayment check={searchParams.get('check') || ''} mutate={mutate}>
            <ShowMediaBoxModal />
            <ShowLinkedinCompany />
            <MediaSettingsLayout />
            <ShowPostSelector />
            <PreConditionComponent />
            <NewSubscription />
            <ContinueProvider />
            <div
              className={clsx(
                'flex flex-col min-h-screen min-w-screen text-newTextColor p-[12px]',
                jakartaSans.className
              )}
            >
              <div>{user?.admin ? <Impersonate /> : <div />}</div>
              {user?.tier === 'FREE' && isGeneral && billingEnabled ? (
                <FirstBillingComponent />
              ) : (
                <div className="flex-1 flex gap-[8px]">
                  <Support />
                  <div className="flex flex-col bg-newBgColorInner w-[80px] rounded-[12px]">
                    <div
                      className={clsx(
                        'fixed h-full w-[64px] start-[17px] flex flex-1 top-0',
                        user?.admin && 'pt-[60px]'
                      )}
                    >
                      <div className="flex flex-col h-full gap-[32px] flex-1 py-[12px]">
                        <Logo />
                        <TopMenu />
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 bg-newBgLineColor rounded-[12px] overflow-hidden flex flex-col gap-[1px] blurMe">
                    <div className="flex bg-newBgColorInner h-[80px] px-[20px] items-center">
                      <div className="text-[24px] font-[600] flex flex-1">
                        <Title />
                      </div>
                      <div className="flex gap-[20px] text-textItemBlur">
                        <OrganizationSelector />
                        <div className="hover:text-newTextColor">
                          <ModeComponent />
                        </div>
                        <div className="w-[1px] h-[20px] bg-blockSeparator" />
                        <LanguageComponent />
                        <ChromeExtensionComponent />
                        <div className="w-[1px] h-[20px] bg-blockSeparator" />
                        <AttachToFeedbackIcon />
                        <NotificationComponent />
                      </div>
                    </div>
                    <div className="flex flex-1 gap-[1px] min-h-0">{children}</div>
                  </div>
                </div>
              )}
            </div>
          </CheckPayment>
        </MantineWrapper>
      </CopilotKit>
    </ContextWrapper>
  );
};
