'use client';

import React, { ReactNode, useEffect, useMemo, useState } from 'react';
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

  // Legacy user loading via /user/self is disabled now that Clerk handles auth.
  // const fetch = useFetch();
  // const load = useCallback(async (path: string) => {
  //   return await (await fetch(path)).json();
  // }, []);
  // const { data: user, mutate } = useSWR('/user/self', load, {
  //   revalidateOnFocus: false,
  //   revalidateOnReconnect: false,
  //   revalidateIfStale: false,
  //   refreshWhenOffline: false,
  //   refreshWhenHidden: false,
  // });

  // For /launches we allow the route to render (it has its own Clerk token guard)
  // without requiring a fully populated "app user".
  if (pathname.startsWith('/launches')) {
    return <>{children}</>;
  }

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
    // Prefer Clerk user when available
    if (isSignedIn && clerkUser) {
      return {
        id: clerkUser.id,
        name: clerkUser.fullName || clerkUser.firstName || 'User',
        email:
          clerkUser.primaryEmailAddress?.emailAddress ||
          clerkUser.emailAddresses?.[0]?.emailAddress ||
          '',

        // App-specific fields (previously from /user/self) defaulted for now
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
  }, [clerkUser, isSignedIn, launchesSession?.email, launchesSession?.name, launchesSession?.userId]);

  // If Clerk is loaded and user is not signed in, send to Clerk sign-in
  if (isLoaded && !user) {
    window.location.href =
      process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || '/sign-in';
    return null;
  }

  const mutate = () => {};

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
                    <div className="flex flex-1 gap-[1px]">{children}</div>
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
