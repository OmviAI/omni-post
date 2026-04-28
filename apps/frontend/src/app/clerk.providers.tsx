'use client';

import { ClerkProvider } from '@clerk/nextjs';
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

/**
 * Wraps the app with ClerkProvider so we can use Clerk-authenticated
 * components and hooks in the frontend. Mirrors the pattern from
 * your other project but keeps existing providers as-is.
 */
export function ClerkAppProviders({ children }: Props) {
  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL}
      signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL}
      afterSignInUrl={process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL}
      afterSignUpUrl={process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL}
    >
      {children}
    </ClerkProvider>
  );
}

