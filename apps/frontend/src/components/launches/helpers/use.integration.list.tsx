'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';

export const useIntegrationList = () => {
  const fetch = useFetch();

  const load = useCallback(
    async (path: string) => {
      try {
        const response = await fetch(path);
        
        if (!response.ok) {
          console.error(`[useIntegrationList] Failed to fetch ${path}: ${response.status} ${response.statusText}`);
          // If 401/403, the user might not be authenticated properly
          if (response.status === 401 || response.status === 403) {
            console.error('[useIntegrationList] Authentication failed - check if JWT cookie is set');
          }
          return [];
        }
        
        const data = await response.json();
        console.log(`[useIntegrationList] Successfully loaded ${data.integrations?.length || 0} integrations`);
        return data.integrations || [];
      } catch (error) {
        console.error(`[useIntegrationList] Error fetching ${path}:`, error);
        return [];
      }
    },
    [fetch]
  );

  return useSWR('/integrations/list', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: [],
  });
};