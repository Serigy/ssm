import { expect, test, type Page } from '@playwright/test';

/**
 * Creation flows.
 *
 * These exist because the list screens shipped with buttons wired to routes
 * that did not exist. The click produced `GET /invoices/nova`, the service
 * rejected "nova" as a malformed id, and the user got a 400 — a dead button is
 * worse than a missing one, and nothing below the browser could see it.
 */

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('E-mail corporativo').fill('admin@serigy.local');
  await page.getByLabel('Senha').fill('serigy-desenvolvimento-2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('.ssm-shell')).toBeVisible();
}

/** Fails the test on any 4xx/5xx, which is how the original defect showed up. */
function watchForApiErrors(page: Page): string[] {
  const bad: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/api/')) bad.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return bad;
}

test('financeiro: emite uma fatura e os totais batem com o servidor', async ({ page }) => {
  await signIn(page);
  const bad = watchForApiErrors(page);

  await page.getByRole('link', { name: 'Financeiro' }).click();
  await page.getByRole('button', { name: 'Emitir fatura' }).click();
  await expect(page.locator('.ssm-topbar__title')).toHaveText('Nova fatura');

  // exact, because "Identificador da contraparte" also contains "contraparte".
  await page.getByLabel('Contraparte', { exact: true }).fill('Cliente de Teste E2E');
  await page.getByLabel('Vencimento').fill('2026-12-31');

  await page.getByLabel('Descrição do item 1').fill('Consultoria');
  await page.getByLabel('Qtd. do item 1').fill('2,5');
  await page.getByLabel('Preço unitário do item 1').fill('150,00');
  await page.getByLabel('Imposto % do item 1').fill('21');

  // 2,5 × 150,00 = 375,00; 21% = 78,75; total 453,75. The preview runs the same
  // computeTotals the service does, so these must agree exactly.
  await expect(page.locator('.ssm-totals__row--grand')).toContainText('R$ 453,75');

  await page.getByRole('button', { name: 'Salvar rascunho' }).click();

  // Lands on the detail screen of the created draft.
  await expect(page.locator('.ssm-topbar__title')).toHaveText('Rascunho de fatura');
  await expect(page.getByText('R$ 453,75').first()).toBeVisible();
  expect(bad, bad.join('\n')).toHaveLength(0);
});

test('pessoas: cadastra um colaborador e recebe matrícula', async ({ page }) => {
  await signIn(page);
  const bad = watchForApiErrors(page);

  await page.getByRole('link', { name: 'Pessoas' }).click();
  await page.getByRole('button', { name: 'Admitir colaborador' }).click();
  await expect(page.locator('.ssm-topbar__title')).toHaveText('Novo colaborador');

  const unique = Date.now();
  await page.getByLabel('Nome', { exact: true }).fill('Joana');
  await page.getByLabel('Sobrenome').fill('Teste');
  await page.getByLabel('E-mail corporativo').fill(`joana.teste.${unique}@serigy.local`);
  await page.getByLabel('Cargo').fill('Analista de dados');
  await page.getByLabel('Data de admissão').fill('2026-10-01');

  await page.getByRole('button', { name: 'Cadastrar colaborador' }).click();

  await expect(page.locator('.ssm-topbar__title')).toHaveText('Joana Teste');
  // Created in onboarding — activation is a separate, event-publishing action.
  await expect(page.getByText('Em admissão')).toBeVisible();
  expect(bad, bad.join('\n')).toHaveLength(0);
});

test('jurídico: cadastra um contrato e recebe referência', async ({ page }) => {
  await signIn(page);
  const bad = watchForApiErrors(page);

  await page.getByRole('link', { name: 'Jurídico' }).click();
  await page.getByRole('button', { name: 'Cadastrar contrato' }).click();
  await expect(page.locator('.ssm-topbar__title')).toHaveText('Novo contrato');

  await page.getByLabel('Título').fill('Contrato de teste E2E');
  // Row 2 is the counterparty; row 1 is pre-filled with us. Addressed by its
  // aria-label, which every row carries even though only the first shows one.
  await page.getByLabel('Nome da parte 2').fill('Contraparte de Teste');
  await page.getByLabel('Vigência a partir de').fill('2026-09-01');

  await page.getByRole('button', { name: 'Cadastrar contrato' }).click();

  await expect(page.locator('.ssm-topbar__title')).toContainText('-2026-');
  await expect(page.getByText('Rascunho')).toBeVisible();
  expect(bad, bad.join('\n')).toHaveLength(0);
});

test('um identificador inválido não vira requisição ao serviço', async ({ page }) => {
  await signIn(page);
  const bad = watchForApiErrors(page);

  // The exact URL that used to produce `GET /invoices/lixo` -> 400.
  await page.goto('/financeiro/faturas/lixo-que-nao-e-uuid');
  await expect(page.getByText('Fatura não encontrada')).toBeVisible();
  expect(bad, bad.join('\n')).toHaveLength(0);
});
