import { useEffect, useState } from 'react';
import { fetchMemberPoll, type MemberPoll } from '../api/polls';

export function useMemberPoll(id: string) {
  const [result, setResult] = useState<{ poll?: MemberPoll; status: number } | 'loading'>('loading');
  useEffect(() => {
    let active = true;
    fetchMemberPoll(id).then(found => { if (active) setResult(found); })
      .catch(() => { if (active) setResult({ status: 0 }); });
    return () => { active = false; };
  }, [id]);
  return result;
}
