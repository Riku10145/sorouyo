import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { GROUP_CREATE_FREE_NOTICE, PLAN_FREE_NOTICE } from '../shared/planCopy';
import { Plan } from './screens/Plan';

afterEach(() => vi.unstubAllGlobals());

test('プラン画面に無料期間と作成済みグループの無料継続を表示する', () => {
  const html = renderToStaticMarkup(createElement(Plan));
  expect(html).toContain(PLAN_FREE_NOTICE);
  expect(html).toContain('1人5グループまで作れます');
  expect(html).toContain('日程調整への回答は、登録なしでいつでも無料です');
});

test('グループ作成フォームだけに無料継続の注意書きを表示する', async () => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  const { GroupForm } = await import('./screens/Groups');
  const createHtml = renderToStaticMarkup(createElement(GroupForm, {
    submitLabel: '作成する',
    showFreeNotice: true,
    onSubmit: async () => null,
  }));
  expect(createHtml).toContain(GROUP_CREATE_FREE_NOTICE);

  const editHtml = renderToStaticMarkup(createElement(GroupForm, {
    initial: { name: '家族', color: '#D97A3D' },
    submitLabel: '保存する',
    onSubmit: async () => null,
  }));
  expect(editHtml).not.toContain(GROUP_CREATE_FREE_NOTICE);
});
