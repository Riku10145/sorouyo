import type { GroupId } from '../../../lib/groups';

export const GROUPS = [
  { id: 'family', name: '家族' },
  { id: 'pair', name: 'ふたり' },
  { id: 'friends', name: 'いつメン' },
  { id: 'games', name: 'ゲーム部' },
] as const satisfies readonly { id: GroupId; name: string }[];

export const groupName = (id: GroupId): string => GROUPS.find(group => group.id === id)!.name;

export type Stamp = 'sun' | 'flower' | 'leaves' | 'star';

export type CalendarEvent = { date: string; title: string; short?: string; time?: string; group: GroupId; stamp?: Stamp };

export const SAMPLE_EVENTS: readonly CalendarEvent[] = [
  { date: '2026-11-04', title: '朝ヨガ', group: 'pair' },
  { date: '2026-11-06', title: '映画', group: 'pair' },
  { date: '2026-11-08', title: '帰省', group: 'family' },
  { date: '2026-11-10', title: '読書会', group: 'friends' },
  { date: '2026-11-11', title: '朝ヨガ', group: 'pair' },
  { date: '2026-11-12', title: 'ボードゲーム', short: 'ボドゲ', group: 'games' },
  { date: '2026-11-14', title: 'ゲーム', group: 'games' },
  { date: '2026-11-15', title: '朝カフェ', short: 'カフェ', group: 'friends' },
  { date: '2026-11-18', title: '朝ヨガ', group: 'pair' },
  { date: '2026-11-19', title: '餃子会', group: 'friends' },
  { date: '2026-11-21', time: '11:00', title: 'おうちランチ', short: 'ランチ', group: 'family', stamp: 'sun' },
  { date: '2026-11-21', time: '17:30', title: '映画デート', short: '映画', group: 'pair', stamp: 'flower' },
  { date: '2026-11-24', title: 'オンラインゲーム', short: 'ゲーム', group: 'games' },
  { date: '2026-11-25', title: '朝ヨガ', group: 'pair' },
  { date: '2026-11-28', title: 'ゲーム', group: 'games' },
  { date: '2026-12-02', title: '朝ヨガ', group: 'pair' },
];
