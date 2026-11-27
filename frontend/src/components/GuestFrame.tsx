import type { ReactNode } from 'react';

export function GuestFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <main className={`guest${wide ? ' guest-wide' : ''}`}>{children}</main>;
}
