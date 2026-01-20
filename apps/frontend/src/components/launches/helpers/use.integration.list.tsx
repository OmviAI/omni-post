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
          return [];
        }
        
        const data = await response.json();
        return data.integrations || [];
      } catch (error) {
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