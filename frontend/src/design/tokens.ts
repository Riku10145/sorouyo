// グループの色。作成・編集画面はこのパレットから選び、DBには先頭の16進色を保存する
export const GROUP_COLORS = [
  { value: '#D97A3D', soft: '#F9E8D9' },
  { value: '#C95D7C', soft: '#F7E2E9' },
  { value: '#4E8A5A', soft: '#E3EFE4' },
  { value: '#7A5CA8', soft: '#EBE4F5' },
  { value: '#4A6E9E', soft: '#E2EAF3' },
  { value: '#B98A2E', soft: '#F3EAD3' },
] as const;

export const DEFAULT_GROUP_COLOR: string = GROUP_COLORS[0].value;
