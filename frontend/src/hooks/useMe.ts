import { useEffect, useState } from 'react';
import { api } from '../api/client';

export type Me = { user: { id: string; email: string; firstName: string | null; lastName: string | null } };

export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    api.api.auth.me.$get().then(async response => {
      if (!active) return;
      setMe(response.ok ? await response.json() as Me : null);
    }).catch(() => { if (active) setMe(null); });
    return () => { active = false; };
  }, []);
  return me;
}
