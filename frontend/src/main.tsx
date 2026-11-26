import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api/client';
import { Toaster } from './components/Toaster';
import { EventDetail } from './feature/calendar/pages/EventDetail';
import { Home } from './feature/calendar/pages/Home';
import { GroupDetail } from './feature/groups/pages/GroupDetail';
import { Groups } from './feature/groups/pages/Groups';
import { JoinGroup } from './feature/groups/pages/JoinGroup';
import { Plan } from './feature/plan/pages/Plan';
import { PollStatus } from './feature/polls/components/PollStatus';
import { findPoll } from './feature/polls/lib/sample';
import { GuestAnswer } from './feature/polls/pages/GuestAnswer';
import { RemotePollStatus } from './feature/polls/pages/MemberPoll';
import { PollCreate } from './feature/polls/pages/PollCreate';
import { PollEdit } from './feature/polls/pages/PollEdit';
import { Polls } from './feature/polls/pages/Polls';
import { scheduleEventNotifications } from './feature/settings/notifications';
import { Settings } from './feature/settings/pages/Settings';
import { validDate, todayInTokyo } from './lib/date';
import { SAMPLE_SELECTED_DATE } from './lib/sampleDate';

import '@fontsource-variable/noto-sans-jp';
import '@fontsource/noto-serif-jp/800.css';
import '@fontsource-variable/dm-sans';
import '@fontsource/dm-serif-text/400.css';
import './design/style.css';

function Screen() {
  const { pathname, search } = window.location;
  const today = todayInTokyo();
  const requested = new URLSearchParams(search).get('date');
  const selected = validDate(requested) ? requested : today;
  if (pathname === '/r' || pathname === '/r/') return <GuestAnswer />;
  if (pathname === '/join' || pathname === '/join/') return <JoinGroup />;
  if (pathname === '/settings' || pathname === '/settings/') return <Settings />;
  if (pathname === '/plan' || pathname === '/plan/') return <Plan />;
  if (pathname === '/groups' || pathname === '/groups/') return <Groups />;
  if (pathname === '/polls' || pathname === '/polls/') return <Polls />;
  if (pathname === '/polls/new' || pathname === '/polls/new/') return <PollCreate />;
  const groupId = pathname.match(/^\/groups\/([\w-]+)\/?$/)?.[1];
  if (groupId) return <GroupDetail id={groupId} selectedDate={selected} />;
  const eventId = pathname.match(/^\/events\/([\w-]+)\/?$/)?.[1];
  if (eventId) return <EventDetail id={eventId} selectedDate={selected} />;
  const pollEditId = pathname.match(/^\/polls\/([\w-]+)\/edit\/?$/)?.[1];
  if (pollEditId) return <PollEdit key={pollEditId} id={pollEditId} selectedDate={selected} />;
  const pollId = pathname.match(/^\/polls\/([\w-]+)\/?$/)?.[1];
  if (pollId) {
    const poll = findPoll(pollId);
    if (poll) return <PollStatus key={pollId} poll={poll} selectedDate={validDate(requested) ? requested : SAMPLE_SELECTED_DATE} />;
    return <RemotePollStatus key={pollId} id={pollId} selectedDate={selected} />;
  }
  return <Home today={today} initialDate={selected} />;
}

function App() {
  useEffect(() => {
    api.api.health.$get().then(response => {
      if (!response.ok) console.warn('APIに接続できません');
    }).catch(() => console.warn('APIに接続できません'));
    scheduleEventNotifications();
  }, []);
  return <><Screen /><Toaster /></>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
