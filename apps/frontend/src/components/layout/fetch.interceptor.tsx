'use client';

import { useEffect } from 'react';

/**
 * Global fetch interceptor to add auth headers for CopilotKit requests
 * This is necessary because CopilotKit doesn't support custom fetch prop
 * and cookies may not be sent in production due to CORS/cookie settings
 */
export function FetchInterceptor() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Helper to get cookie value
    const getCookie = (name: string): string | null => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
      return null;
    };

    // Store original fetch
    const originalFetch = window.fetch;

    // Override fetch
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      
      // Only intercept requests to copilot endpoints
      if (url.includes('/copilot/')) {
        const authCookie = getCookie('auth');
        const showorgCookie = getCookie('showorg');
        
        // Create new headers
        const headers = new Headers(init?.headers);
        
        // Add auth headers if cookies exist and headers don't already have them
        if (authCookie && !headers.has('auth')) {
          headers.set('auth', authCookie);
        }
        if (showorgCookie && !headers.has('showorg')) {
          headers.set('showorg', showorgCookie);
        }
        
        // Merge with existing init options
        const newInit: RequestInit = {
          ...init,
          credentials: 'include',
          headers,
        };
        
        console.log(`[FetchInterceptor] Intercepted ${url}, added auth headers: ${!!authCookie}, showorg: ${!!showorgCookie}`);
        
        return originalFetch(input, newInit);
      }
      
      // For non-copilot requests, use original fetch
      return originalFetch(input, init);
    };

    // Cleanup: restore original fetch on unmount
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
