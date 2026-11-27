/** UTCのISOを画面表示用の日本時間に変換する。 */
export const toJst = (iso: string): { date: string; time: string } => ({
  date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)),
  time: new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)),
});

export const DAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

const padded = (number: number) => String(number).padStart(2, '0');

export const dateKey = (date: Date): string => `${date.getFullYear()}-${padded(date.getMonth() + 1)}-${padded(date.getDate())}`;

export const dateFromKey = (key: string): Date => {
  const [year = NaN, month = NaN, day = NaN] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const validDate = (key: unknown): key is string => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && dateKey(dateFromKey(key)) === key;

export function dateLabel(key: string, { year = false }: { year?: boolean } = {}): string {
  const date = dateFromKey(key);
  return `${year ? date.getFullYear() + '年' : ''}${date.getMonth() + 1}月${date.getDate()}日（${DAYS[date.getDay()]}）`;
}

export function monthCells(month: string): string[] {
  const [year = NaN, m = NaN] = month.split('-').map(Number);
  const first = new Date(year, m - 1, 1).getDay();
  const days = new Date(year, m, 0).getDate();
  return Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, i) =>
    dateKey(new Date(year, m - 1, 1 + i - first))
  );
}

export function shiftedMonth(month: string, direction: number): string {
  const [year = NaN, number = NaN] = month.split('-').map(Number);
  return dateKey(new Date(year, number - 1 + direction, 1)).slice(0, 7);
}

export const shortDate = (key: string): string => `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`;

/** 開始時刻の表示。空なら終日 */
export const timeLabel = (time: string): string => time ? `${time}〜` : '終日';

export const weekday = (key: string): string => DAYS[dateFromKey(key).getDay()]!;

export const dayTone = (key: string): 'sun' | 'sat' | undefined => {
  const day = dateFromKey(key).getDay();
  return day === 0 ? 'sun' : day === 6 ? 'sat' : undefined;
};

export const todayInTokyo = (): string => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
