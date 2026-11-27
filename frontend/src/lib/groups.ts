import type { CSSProperties } from 'react';
import { GROUP_COLORS } from '../design/tokens';

export type GroupId = 'family' | 'pair' | 'friends' | 'games';

export const softOf = (color: string): string => GROUP_COLORS.find(item => item.value === color)?.soft ?? `${color}26`;

/** グループ表示: color があれば16進色のCSS変数、なければサンプルの g-* クラスを使う */
export type DisplayGroup = { id: string; name: string; color?: string | null; className?: GroupId };

export const groupVars = (group: { color?: string | null }): CSSProperties | undefined =>
  group.color ? ({ '--g': group.color, '--g-soft': softOf(group.color) } as CSSProperties) : undefined;

export const groupCls = (group: DisplayGroup): string => group.color ? '' : `g-${group.className ?? 'friends'}`;
