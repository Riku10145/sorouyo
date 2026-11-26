import type { Me } from '../hooks/useMe';

export const displayName = (me: Me) =>
  [me.user.lastName, me.user.firstName].filter(Boolean).join(' ') || me.user.email;
