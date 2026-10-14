import { test, expect } from '@playwright/test';

const field = (page, name) => page.locator(`[name="${name}"]`);
async function fill(page) {
  await field(page, 'username').fill('renamed');
  await field(page, 'current_password').fill('current secret');
  await field(page, 'new_password').fill('new secret password');
  await field(page, 'confirm_password').fill('new secret password');
}
async function submit(page) {
  await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
async function settle(page, index, failure) {
  await page.evaluate(({ index, failure }) => {
    const request = window.accountRequests[index];
    if (failure) request.reject({ code: failure }); else request.resolve();
  }, { index, failure });
}
test.beforeEach(async ({ page }) => { await page.goto('/account-lifecycle.html?lang=en'); });

for (const replacement of ['client', 'username']) {
  test(`${replacement} replacement clears account drafts`, async ({ page }) => {
    await fill(page);
    await page.getByRole('button', { name: `Replace ${replacement}`, exact: true }).click();
    await expect(field(page, 'username')).toHaveValue(replacement === 'username' ? 'other' : 'admin');
    for (const name of ['current_password', 'new_password', 'confirm_password']) await expect(field(page, name)).toHaveValue('');
  });
}

test('old failure cannot erase a replacement draft or unlock its pending submission', async ({ page }) => {
  await fill(page);
  await page.locator('form').evaluate(form => {
    for (let i = 0; i < 2; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(await page.evaluate(() => window.accountRequests.length)).toBe(1);
  await page.getByRole('button', { name: 'Replace client', exact: true }).click();
  await expect(page.locator('form button')).toBeEnabled();
  await fill(page);
  await field(page, 'current_password').fill('replacement secret');
  await submit(page);
  await settle(page, 0, 'admin.current_password_invalid');
  await expect(field(page, 'current_password')).toHaveValue('replacement secret');
  await expect(page.locator('form button')).toBeDisabled();
  await expect(page.locator('form')).not.toContainText('current password is incorrect');
  await submit(page);
  expect(await page.evaluate(() => window.accountRequests.length)).toBe(2);
  await settle(page, 1);
  await expect(page.locator('form button')).toBeEnabled();
  expect(await page.evaluate(() => window.accountUpdates)).toEqual(['new']);
});

test('old success does not notify a replacement account', async ({ page }) => {
  await fill(page); await submit(page);
  await page.getByRole('button', { name: 'Replace client', exact: true }).click();
  await field(page, 'current_password').fill('replacement secret');
  await settle(page, 0);
  await expect(field(page, 'current_password')).toHaveValue('replacement secret');
  expect(await page.evaluate(() => window.accountUpdates)).toEqual([]);
});

for (const failure of [undefined, 'admin.current_password_invalid']) {
  test(`unmount clears secrets and handles late ${failure ? 'failure' : 'session-revocation success'}`, async ({ page }) => {
    await fill(page); await submit(page);
    await page.getByRole('button', { name: 'Unmount account', exact: true }).click();
    await expect(page.locator('form')).toHaveCount(0);
    expect(await page.evaluate(() => window.detachedPasswords.map(field => field.value))).toEqual(['', '', '']);
    await settle(page, 0, failure);
    expect(await page.evaluate(() => window.accountUpdates)).toEqual(failure ? [] : ['old']);
  });
}

test('normal failure clears passwords and permits a successful retry', async ({ page }) => {
  await fill(page); await submit(page); await settle(page, 0, 'admin.current_password_invalid');
  await expect(page.locator('form')).toContainText('current password is incorrect');
  for (const name of ['current_password', 'new_password', 'confirm_password']) await expect(field(page, name)).toHaveValue('');
  await expect(page.locator('form button')).toBeEnabled();
  await fill(page); await submit(page); await settle(page, 1);
  await expect(field(page, 'current_password')).toHaveValue('');
  expect(await page.evaluate(() => window.accountUpdates)).toEqual(['old']);
});
