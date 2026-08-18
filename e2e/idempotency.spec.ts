import { expect, test, type Page } from '@playwright/test';

/**
 * The client half of the idempotency contract.
 *
 * Marking endpoints @Idempotent() made `Idempotency-Key` mandatory on them, and
 * the frontend was not sending one — so "Emitir fatura" started answering 400.
 * A server-side requirement the client does not honour is the same defect class
 * as a button wired to a route that does not exist: it only shows up in a
 * browser.
 */

/**
 * Collects API failures, starting only once the user is signed in.
 *
 * Attaching earlier catches the two 401s the shell produces on every anonymous
 * page load — it tries a silent refresh, gets told there is no session, and
 * shows the login screen. Those are the system working, and counting them makes
 * the assertion useless.
 */
function watchApiErrors(page: Page): string[] {
  const bad: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/api/')) bad.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return bad;
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('E-mail corporativo').fill('admin@serigy.local');
  await page.getByLabel('Senha').fill('serigy-desenvolvimento-2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('.ssm-shell')).toBeVisible();
}

/** Creates a draft and returns the detail URL, so each test starts clean. */
async function createDraft(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Financeiro' }).click();
  await page.getByRole('button', { name: 'Emitir fatura' }).click();
  await page.getByLabel('Contraparte', { exact: true }).fill(`Idempotência ${Date.now()}`);
  await page.getByLabel('Vencimento').fill('2026-12-31');
  await page.getByLabel('Descrição do item 1').fill('Item');
  await page.getByLabel('Preço unitário do item 1').fill('100,00');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.locator('.ssm-topbar__title')).toHaveText('Rascunho de fatura');
}

test('emitir uma fatura funciona pela interface', async ({ page }) => {
  await signIn(page);
  const bad = watchApiErrors(page);
  await createDraft(page);

  await page.getByRole('button', { name: 'Emitir fatura' }).click();
  await page.getByRole('button', { name: 'Emitir fatura' }).last().click();

  await expect(page.locator('.ssm-topbar__title')).toContainText('FAT-');
  await expect(page.getByText('Emitida').first()).toBeVisible();
  expect(bad, bad.join('\n')).toHaveLength(0);
});

test('emitir duas vezes repete a resposta em vez de errar', async ({ page }) => {
  await signIn(page);
  await createDraft(page);
  const url = page.url();

  await page.getByRole('button', { name: 'Emitir fatura' }).click();
  await page.getByRole('button', { name: 'Emitir fatura' }).last().click();
  await expect(page.locator('.ssm-topbar__title')).toContainText('FAT-');
  const numero = await page.locator('.ssm-topbar__title').textContent();

  // Second attempt at the same operation. The key is derived from the invoice
  // id, so this replays the stored 200 rather than hitting the state machine's
  // 409 — the user sees success, which is what "already done" should look like.
  await page.goto(url);
  const issueButton = page.getByRole('button', { name: 'Emitir fatura' });
  if (await issueButton.count()) {
    await issueButton.click();
    await page.getByRole('button', { name: 'Emitir fatura' }).last().click();
    await page.waitForTimeout(1500);
  }

  await expect(page.locator('.ssm-topbar__title')).toHaveText(numero!);
  await expect(page.getByText('Emitida').first()).toBeVisible();
});

test('concluir admissão funciona pela interface', async ({ page }) => {
  await signIn(page);
  const bad = watchApiErrors(page);
  await page.getByRole('link', { name: 'Pessoas' }).click();
  await page.getByRole('button', { name: 'Admitir colaborador' }).click();

  const unique = Date.now();
  await page.getByLabel('Nome', { exact: true }).fill('Idem');
  await page.getByLabel('Sobrenome').fill('Potente');
  await page.getByLabel('E-mail corporativo').fill(`idem.${unique}@serigy.local`);
  await page.getByLabel('Cargo').fill('Analista');
  await page.getByLabel('Data de admissão').fill('2026-10-01');
  await page.getByRole('button', { name: 'Cadastrar colaborador' }).click();
  // Scoped to the content area, and to the badge rather than any matching text:
  // the topbar carries a permanent "Operacional" badge, and the creation screen
  // has an explanatory card that repeats the words "Em admissão".
  const statusBadge = page.locator('.ssm-content .ssm-badge').first();
  await expect(statusBadge).toHaveText('Em admissão');

  await page.getByRole('button', { name: 'Concluir admissão' }).click();
  await expect(statusBadge).toHaveText('Ativo');
  expect(bad, bad.join('\n')).toHaveLength(0);
});
