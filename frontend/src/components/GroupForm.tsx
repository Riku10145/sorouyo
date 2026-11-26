import { useState, type FormEvent } from 'react';
import { GROUP_COLORS, DEFAULT_GROUP_COLOR } from '../design/tokens';
import { GROUP_CREATE_FREE_NOTICE } from '../lib/planCopy';

/** 名前+色の入力フォーム。エラー時も入力した名前を消さない */
export function GroupForm({ initial, submitLabel, onSubmit, onCancel, showFreeNotice = false }: {
  initial?: { name: string; color: string | null };
  submitLabel: string;
  onSubmit: (name: string, color: string) => Promise<string | null>;
  onCancel?: () => void;
  showFreeNotice?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? DEFAULT_GROUP_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('グループ名を入力してください'); return; }
    setBusy(true);
    const message = await onSubmit(name.trim(), color).catch(() => '保存できませんでした');
    setBusy(false);
    if (message) { setError(message); return; }
    if (!initial) { setName(''); setColor(DEFAULT_GROUP_COLOR); }
    setError(null);
  };

  return <form className="group-form" onSubmit={submit} aria-label="グループの入力">
    <label className="field">グループ名
      <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="例：家族、いつメン" aria-invalid={!!error} />
    </label>
    <fieldset className="field">
      <legend>色</legend>
      <div className="color-swatches" role="radiogroup">
        {GROUP_COLORS.map(item => <button key={item.value} type="button" role="radio" aria-checked={color === item.value}
          className={`swatch${color === item.value ? ' on' : ''}`} style={{ background: item.value }} onClick={() => setColor(item.value)}
          aria-label={`色 ${item.value}`} />)}
      </div>
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    {showFreeNotice && <p className="hint">{GROUP_CREATE_FREE_NOTICE}</p>}
    <div className="about-actions">
      {onCancel && <button type="button" className="ghost-btn" onClick={onCancel}>キャンセル</button>}
      <button type="submit" className="primary-btn" disabled={busy}>{busy ? '保存中…' : submitLabel}</button>
    </div>
  </form>;
}
