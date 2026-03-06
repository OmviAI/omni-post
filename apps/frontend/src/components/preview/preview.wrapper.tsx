'use client';

import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { CopilotKit } from '@copilotkit/react-core';
import { useUser as useClerkUser } from '@clerk/nextjs';

export const PreviewWrapper = ({ children }: { children: ReactNode }) => {
  const { backendUrl } = useVariables();
  const { isSignedIn, user: clerkUser } = useClerkUser();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  const user = useMemo(() => {
    if (isSignedIn && clerkUser) {
      return {
        id: clerkUser.id,
        name: clerkUser.fullName || clerkUser.firstName || 'User',
        email:
          clerkUser.primaryEmailAddress?.emailAddress ||
          clerkUser.emailAddresses?.[0]?.emailAddress ||
          '',
        orgId: '',
        tier: 'FREE' as const,
        role: 'USER' as const,
        publicApi: '',
        totalChannels: 0,
      };
    }

    // Preview can be used without being signed in; provide a safe placeholder.
    return {
      id: 'preview',
      name: 'Preview',
      email: '',
      orgId: '',
      tier: 'FREE' as const,
      role: 'USER' as const,
      publicApi: '',
      totalChannels: 0,
    };
  }, [clerkUser, isSignedIn]);

  if (!ready) return null;
  return (
    <ContextWrapper user={user as any}>
      <CopilotKit
        credentials="include"
        runtimeUrl={backendUrl + '/copilot/chat'}
        showDevConsole={false}
      >
        <MantineWrapper>
          <Toaster />
          {children}
        </MantineWrapper>
      </CopilotKit>
    </ContextWrapper>
  );
};
