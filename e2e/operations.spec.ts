import { expect, test, type Page } from '@playwright/test';

/**
 * The fourth module.
 *
 * Two things get checked here that no other suite can: that a fourth federated
 * remote mounts alongside the three that already work, and that the ticket
 * lifecycle drives the environment's state — which is the module's whole
 * reason for existing.
 */

async function signIn(page: Page, email = 'admin@serigy.local'): Promise<void> {
  await page.goto('/');
  await page.getByLabel('E-mail corporativo').fill(email);
  await page.getByLabel('Senha').fill('serigy-desenvolvimento-2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('.ssm-shell')).toBeVisible();
}

test('o módulo monta e mostra a fila de chamados', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('.ssm-nav-item')).toHaveText([
    'Visão geral',
    'Financeiro',
    'Pessoas',
    'Jurídico',
    'Operações',
  ]);

  await page.getByRole('link', { name: 'Operações' }).click();
  await expect(page.getByText('Não foi possível carregar este módulo')).toHaveCount(0);
  await expect(page.locator('.ssm-topbar__title')).toHaveText('Chamados');

  const table = page.locator('.ssm-table').first();
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr').first()).toBeVisible();
});

test('o inventário de ambientes carrega', async ({ page }) => {
  await signIn(page);
  await page.goto('/operacoes/ambientes');
  await expect(page.locator('.ssm-topbar__title')).toHaveText('Ambientes');
  // Asserts the seeded environments are present rather than an exact count.
  // Counting shared demo data makes the test fail the moment anyone creates a
  // record by hand — which is not a defect in the code under test.
  for (const code of ['amb-prod-01', 'amb-hom-01', 'amb-dados-01']) {
    await expect(page.getByText(code)).toBeVisible();
  }
});

test('abrir um sev1 coloca o ambiente em incidente e resolvê-lo o devolve', async ({ page }) => {
  await signIn(page);
  await page.goto('/operacoes/chamados/novo');

  await page.getByLabel('Assunto').fill(`Falha total E2E ${Date.now()}`);
  // Selected by the option's value, read from its text: the label carries the
  // environment's full name and would be brittle to spell out here.
  const envSelect = page.getByLabel('Ambiente');
  const envValue = await envSelect
    .locator('option', { hasText: 'amb-hom-01' })
    .getAttribute('value');
  await envSelect.selectOption(envValue!);
  await page.getByLabel('Severidade').selectOption('sev1');
  await page.getByRole('button', { name: 'Abrir chamado' }).click();

  // Lands on the detail screen of the new ticket.
  await expect(page.locator('.ssm-topbar__title')).toContainText('#');
  await expect(page.getByText('Severidade 1').first()).toBeVisible();

  // The inventory must reflect it without anyone updating it by hand.
  await page.goto('/operacoes/ambientes');
  const row = page.locator('.ssm-table tbody tr', { hasText: 'amb-hom-01' });
  await expect(row.getByText('Incidente')).toBeVisible();

  // Work it through to resolved.
  await page.goto('/operacoes/chamados');
  await page.locator('.ssm-table tbody tr', { hasText: 'Falha total E2E' }).first().click();
  await page.getByRole('button', { name: 'Assumir atendimento' }).click();
  await expect(page.getByText('Em atendimento').first()).toBeVisible();
  await page.getByRole('button', { name: 'Resolver' }).click();
  await expect(page.getByText('Resolvido').first()).toBeVisible();

  // And the environment recovers on its own.
  await page.goto('/operacoes/ambientes');
  await expect(
    page.locator('.ssm-table tbody tr', { hasText: 'amb-hom-01' }).getByText('Operacional'),
  ).toBeVisible();
});

test('a tela de SLA mostra a apuração e o crédito devido', async ({ page }) => {
  await signIn(page);
  await page.goto('/operacoes/sla');
  await expect(page.locator('.ssm-topbar__title')).toHaveText('SLA');
  // July was reckoned at 98,38% against a 99,50% target — two penalty steps.
  await expect(page.getByText('Descumprido').first()).toBeVisible();
  await expect(page.getByText('R$ 1.500,00').first()).toBeVisible();
});

test('o plantão vê Operações e nada mais', async ({ page }) => {
  // operations:oncall grants no financial, hr or legal permission at all, so
  // the shell never even fetches those remotes.
  await signIn(page, 'plantao@serigy.local');
  await expect(page.locator('.ssm-nav-item')).toHaveText(['Visão geral', 'Operações']);
});
