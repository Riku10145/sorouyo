import { AppShell } from '../../../components/AppShell';
import { MobileHeader } from '../../../components/MobileHeader';
import { PLAN_FREE_NOTICE } from '../../../lib/planCopy';

export function Plan() {
  return <AppShell active="plan" selectedDate="" groups={[]}>
    <MobileHeader />
    <h1 className="page-title">プラン</h1>
    <section className="empty-hero" aria-labelledby="free-plan-heading">
      <h2 id="free-plan-heading">ご案内</h2>
      <p>{PLAN_FREE_NOTICE}</p>
    </section>
  </AppShell>;
}
