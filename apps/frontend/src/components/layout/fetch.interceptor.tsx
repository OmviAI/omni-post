'use client';

import { useEffect } from 'react';

/**
 * Global fetch interceptor to add auth headers for CopilotKit requests
 * This is necessary because CopilotKit doesn't support custom fetch prop
 * and cookies may not be sent in production due to CORS/cookie settings
 */
export function FetchInterceptor(): null {
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
      
      // Intercept requests to copilot endpoints - add auth headers
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
      
      // Intercept R2 upload requests - handle CORS by ensuring proper headers
      if (url.includes('.r2.cloudflarestorage.com') || url.includes('r2.dev')) {
        // For R2 uploads, we need to ensure the request has proper CORS handling
        // The presigned URL should work, but we need to make sure we're not adding conflicting headers
        const newInit: RequestInit = {
          ...init,
          // Don't add custom headers to R2 requests - let the presigned URL handle it
          // But ensure credentials are not included (R2 doesn't need them for presigned URLs)
          mode: 'cors',
        };
        
        console.log(`[FetchInterceptor] Intercepted R2 upload: ${url.substring(0, 100)}...`);
        
        try {
          return await originalFetch(input, newInit);
        } catch (error: any) {
          // If CORS error, log it for debugging
          if (error.message?.includes('CORS') || error.message?.includes('cors')) {
            console.error(`[FetchInterceptor] CORS error on R2 upload: ${error.message}`);
            console.error(`[FetchInterceptor] URL: ${url}`);
            console.error(`[FetchInterceptor] This usually means CORS is not configured on the R2 bucket`);
          }
          throw error;
        }
      }
      
      // For all other requests, use original fetch
      return originalFetch(input, init);
    };

    // Cleanup: restore original fetch on unmount
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
