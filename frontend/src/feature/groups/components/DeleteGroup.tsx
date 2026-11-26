import { useState } from 'react';
import { toast } from '../../../components/Toaster';
import { deleteGroup, type GroupDetail as Detail } from '../api';

export function DeleteGroup({ group, counts }: Pick<Detail, 'group' | 'counts'>) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    const ok = await deleteGroup(group.id);
    setBusy(false);
    if (!ok) { toast('削除できませんでした'); return; }
    toast(`「${group.name}」を削除しました`);
    window.location.href = '/groups';
  };
  return <section className="card danger-zone">
    <h2>グループを削除</h2>
    {confirming ? <>
      <p>「<strong>{group.name}</strong>」を削除します。所属する予定{counts.events}件・日程調整{counts.polls}件・参加リンクがすべて消え、元に戻せません。</p>
      <div className="about-actions">
        <button type="button" className="ghost-btn" onClick={() => setConfirming(false)}>キャンセル</button>
        <button type="button" className="primary-btn danger" disabled={busy} onClick={() => void remove()}>{busy ? '削除中…' : '削除する'}</button>
      </div>
    </> : <button type="button" className="ghost-btn danger" onClick={() => setConfirming(true)}>削除する…</button>}
  </section>;
}
