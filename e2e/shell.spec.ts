import { expect, test, type Page } from '@playwright/test';

/**
 * The federation smoke test.
 *
 * Every assertion here corresponds to a bug that actually shipped into this
 * repository and was invisible to typecheck, unit tests and curl:
 *
 *  - the module contract broke because @ssm/mfe-runtime cannot be a federation
 *    singleton, so the remote read from a different React context;
 *  - the plugin rewrote App.tsx into an async bootstrap and its named export
 *    vanished;
 *  - React.lazy() was called inside render, so the shell re-suspended forever
 *    and React hid the resolved subtree with `display: none !important` —
 *    which is the nastiest of the three, because the module mounts, runs its
 *    effects and loads its data while showing a blank screen.
 *
 * A test that only checked "no console errors" would have passed through all
 * three. These check that content is *visible*.
 */

const CREDENTIALS = {
  admin: { email: 'admin@serigy.local', password: 'serigy-desenvolvimento-2026' },
  financeiro: { email: 'financeiro@serigy.local', password: 'serigy-desenvolvimento-2026' },
};

async function signIn(page: Page, who: keyof typeof CREDENTIALS): Promise<void> {
  await page.goto('/');
  await page.getByLabel('E-mail corporativo').fill(CREDENTIALS[who].email);
  await page.getByLabel('Senha').fill(CREDENTIALS[who].password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('.ssm-shell')).toBeVisible();
}

test.describe('shell', () => {
  test('entra e mostra os módulos do usuário', async ({ page }) => {
    await signIn(page, 'admin');
    await expect(page.locator('.ssm-topbar__title')).toHaveText('Visão geral');
    await expect(page.locator('.ssm-nav-item')).toHaveText([
      'Visão geral',
      'Financeiro',
      'Pessoas',
      'Jurídico',
      'Operações',
    ]);
  });

  test('esconde os módulos que o papel não alcança', async ({ page }) => {
    // The controller role only grants financial:* permissions, so identity-svc
    // returns modules: ['financial'] and the shell never even fetches the other
    // two remotes.
    await signIn(page, 'financeiro');
    await expect(page.locator('.ssm-nav-item')).toHaveText(['Visão geral', 'Financeiro']);
    await expect(page.getByRole('link', { name: 'Pessoas' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Jurídico' })).toHaveCount(0);
  });
});

/**
 * `column` is the text as AUTHORED, not as displayed. The design system sets
 * `text-transform: uppercase` on table headers, and toHaveText reads
 * textContent — which is the untransformed source. Asserting "NÚMERO" here
 * fails against a perfectly correct page.
 */
const MODULES = [
  { label: 'Financeiro', path: '/financeiro', title: 'Faturas', column: 'Número' },
  { label: 'Pessoas', path: '/pessoas', title: 'Colaboradores', column: 'Matrícula' },
  { label: 'Jurídico', path: '/juridico', title: 'Contratos', column: 'Referência' },
  { label: 'Operações', path: '/operacoes', title: 'Chamados', column: 'Chamado' },
];

test.describe('micro-frontends federados', () => {
  for (const mod of MODULES) {
    test(`${mod.label} monta e renderiza dados`, async ({ page }) => {
      await signIn(page, 'admin');
      await page.getByRole('link', { name: mod.label }).click();

      // The error boundary must not have caught anything.
      await expect(page.getByText('Não foi possível carregar este módulo')).toHaveCount(0);

      // The module owns the topbar title, which proves its effects ran.
      await expect(page.locator('.ssm-topbar__title')).toHaveText(mod.title);

      // And — the assertion that matters — the content is actually VISIBLE.
      // Present-but-hidden is exactly what the re-suspend bug produced.
      const table = page.locator('.ssm-table').first();
      await expect(table).toBeVisible();
      await expect(table.locator('th').first()).toHaveText(mod.column);
      await expect(table.locator('tbody tr').first()).toBeVisible();

      // The design system's rules for a data table, checked where they are
      // actually decided — in the computed style, not in the markup.
      const header = table.locator('th').first();
      await expect(header).toHaveCSS('text-transform', 'uppercase');
      await expect(header).toHaveCSS('font-family', /JetBrains Mono/);
    });
  }

  test('navegar entre módulos não deixa nenhum em branco', async ({ page }) => {
    await signIn(page, 'admin');
    // Twice around: a stale lazy component only misbehaves on re-entry.
    for (const pass of [1, 2]) {
      for (const mod of MODULES) {
        await page.getByRole('link', { name: mod.label }).click();
        await expect(page.locator('.ssm-table').first(), `${mod.label}, passagem ${pass}`)
          .toBeVisible();
      }
    }
  });
});

test.describe('dados', () => {
  test('valores monetários vêm formatados em pt-BR', async ({ page }) => {
    await signIn(page, 'admin');
    await page.getByRole('link', { name: 'Financeiro' }).click();
    // Server-computed integers, rendered by the ui-kit formatter.
    await expect(page.getByText('R$ 12.500,00').first()).toBeVisible();
  });

  test('a fatura paga mostra saldo zero em aberto', async ({ page }) => {
    await signIn(page, 'admin');
    await page.getByRole('link', { name: 'Financeiro' }).click();
    const row = page.locator('.ssm-table tbody tr', { hasText: 'FAT-2026-00002' });
    await expect(row.getByText('Paga')).toBeVisible();
    await expect(row.getByText('R$ 0,00')).toBeVisible();
  });
});
