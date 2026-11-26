import { Brand, Icon } from '../design/ui';
import { PLAN_FREE_NOTICE } from '../../shared/planCopy';
import { AppShell } from './Shell';

export function Plan() {
  return <AppShell active="plan" selectedDate="" groups={[]}>
    <header className="m-header"><Brand /><a className="text-btn" href="/settings"><Icon name="settings" size={20} />設定</a></header>
    <h1 className="page-title">プラン</h1>
    <section className="empty-hero" aria-labelledby="free-plan-heading">
      <h2 id="free-plan-heading">ご案内</h2>
      <p>{PLAN_FREE_NOTICE}</p>
    </section>
  </AppShell>;
}
