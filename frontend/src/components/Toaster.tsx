import { useEffect, useState } from 'react';

let showToast: (message: string) => void = () => {};

export const notReady = (what: string) => showToast(`${what}は次の更新で使えるようになります`);

export const toast = (message: string) => showToast(message);

export function Toaster() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    showToast = next => { setMessage(next); clearTimeout(timer); timer = setTimeout(() => setMessage(''), 3200); };
    return () => clearTimeout(timer);
  }, []);
  return <div role="status" aria-live="polite">{message && <div className="toast">{message}</div>}</div>;
}
