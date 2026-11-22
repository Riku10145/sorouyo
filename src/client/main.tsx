import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { hc } from 'hono/client';
import '@fontsource-variable/noto-sans-jp';
import '@fontsource/noto-serif-jp/800.css';
import '@fontsource-variable/dm-sans';
import '@fontsource/dm-serif-text/400.css';
import type { AppType } from '../worker';
import { validDate } from '../shared/model';
import { SAMPLE_SELECTED_DATE, findPoll } from '../shared/sample';
import { Toaster } from './design/ui';
import { Home, todayInTokyo } from './screens/Home';
import { PollStatus } from './screens/PollStatus';
import { GuestAnswer } from './screens/GuestAnswer';
import { Settings } from './screens/Settings';
import './style.css';

const api = hc<AppType>(window.location.origin);

function Screen() {
  const { pathname, search } = window.location;
  const today = todayInTokyo();
  const requested = new URLSearchParams(search).get('date');
  const selected = validDate(requested) ? requested : today;
  if (pathname === '/r' || pathname === '/r/') return <GuestAnswer />;
  if (pathname === '/settings' || pathname === '/settings/') return <Settings api={api} />;
  const poll = findPoll(pathname.match(/^\/polls\/([\w-]+)\/?$/)?.[1] ?? '');
  if (poll) return <PollStatus poll={poll} selectedDate={validDate(requested) ? requested : SAMPLE_SELECTED_DATE} />;
  return <Home today={today} initialDate={selected} />;
}

function App() {
  useEffect(() => {
    api.api.health.$get().then(response => {
      if (!response.ok) console.warn('APIに接続できません');
    }).catch(() => console.warn('APIに接続できません'));
  }, []);
  return <><Screen /><Toaster /></>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
