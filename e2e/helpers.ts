import { Page } from '@playwright/test';

export async function login(page: Page, email = 'admin@clothingerp.com', password = 'admin123') {
  await page.goto('/login');
  await page.fill('input[formcontrolname="email"]', email);
  await page.fill('input[formcontrolname="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}
