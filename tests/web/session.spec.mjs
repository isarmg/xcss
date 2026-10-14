import { test, expect } from '@playwright/test';

test('replacing the session client never commits the previous administrator under the new context', async ({ page }) => {
  await page.goto('/session.html');
  await expect(page.locator('output')).toHaveText('old_admin');
  await page.getByRole('button', { name: 'Replace client' }).click();
  await expect(page.locator('output')).toHaveText('anonymous');
  const commits = await page.evaluate(() => window.sessionCommits.filter(item => item.replacement));
  expect(commits.length).toBeGreaterThan(0);
  expect(commits.every(item => item.username === null)).toBe(true);
});

test('an old client logout failure cannot contaminate replacement state', async ({ page }) => {
  await page.goto('/session.html?delayedLogout=1');
  await expect(page.locator('output')).toHaveText('old_admin');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForFunction(() => typeof window.failOldLogout === 'function');
  await page.getByRole('button', { name: 'Replace client' }).click();
  await expect(page.locator('output')).toHaveText('new_admin');
  await page.evaluate(() => window.failOldLogout());
  await expect(page.locator('output')).toHaveText('new_admin');
  await page.getByRole('button', { name: 'Fail sign in' }).click();
  await expect(page.locator('output')).toHaveText('anonymous');
});
