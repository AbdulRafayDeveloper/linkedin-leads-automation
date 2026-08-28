import { test, expect, type APIRequestContext } from '@playwright/test';

const PRIYA_SALES_NAV_SAMPLE = `Home
Accounts
Leads
Smart Links
Messaging
Actions List
Referrals

7
7 new notifications

Abdul Rafay Full Stack AI DeveloperAbdul Rafay Full Stack AI Developer's profile picture
Search
Search
Search
Lead filters
Account filters

Saved searches

Personas


Sales Navigator Lead Page
Basic lead information for Priya Nandakumar.

's profile picture
Priya Nandakumar.
2nd
Viewed: 8/28/2026
VP Engineering at Solstice Robotics
Melbourne, Victoria, Australia
512 connections

Save

Message

Current role
Solstice Robotics
Vice President of Engineering at Solstice Robotics

Jan 2022–Present  4 yrs 8 mos

No job description

Contact information

Add contact info
Search on Bing


Lead IQNew
About
Relationship
Experience
Get insights about Priya
BETA
View personalized AI powered insights based on Priya's profile and activity. Learn more


Generate Lead IQ
About
I lead the engineering org at Solstice Robotics, scaling our warehouse automation platform … Show more
Relationship
You and Priya don't share anything in common on LinkedIn. Search for leads at Solstice Robotics instead.

Search leads
Priya's experience
Priya has worked for 2 different companies over their professional career

Solstice Robotics
Vice President of Engineering
Solstice Robotics

Jan 2022–Present  4 yrs 8 mos

Melbourne, Victoria, Australia

Education
Monash University
Monash University
Bachelor of Engineering (Honours) Software Engineering

2012 – 2016

Interests
Show all skills
Lead actions panel
Lists (0)

Save
Add to a list to help organize leads and get alerts

Timeline
Your past history with Priya and key events

You have no previous activity with Priya

0 notifications total

Chat with us`;

async function clearAllLeads(request: APIRequestContext, baseURL: string) {
  const response = await request.get(`${baseURL}/api/leads?limit=200`);
  const body = await response.json();
  const ids = (body.leads || []).map((lead: { _id: string }) => lead._id);
  if (ids.length > 0) {
    await request.delete(`${baseURL}/api/leads`, { data: { ids } });
  }
}

test.describe.serial('LinkedIn lead workflow', () => {
  test.beforeAll(async ({ request, baseURL }) => {
    await clearAllLeads(request, baseURL!);
  });

  test('home page loads with stats and navigation buttons', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'LinkedIn Lead Intelligence Engine' })).toBeVisible();
    await expect(page.getByText('Total Leads')).toBeVisible();
    await expect(page.locator('main').getByRole('link', { name: 'Process New Lead' })).toBeVisible();
    await expect(page.locator('main').getByRole('link', { name: 'View My Leads' })).toBeVisible();

    expect(errors, `Console errors on home page: ${errors.join('; ')}`).toEqual([]);
  });

  test('sidebar navigation moves between pages and highlights the active link', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'My Leads' }).first().click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('link', { name: 'My Leads' }).first()).toHaveAttribute(
      'aria-current',
      'page'
    );

    await page.getByRole('link', { name: 'Process New Lead' }).first().click();
    await expect(page).toHaveURL(/\/process$/);
    await expect(page.getByRole('link', { name: 'Process New Lead' }).first()).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  test('mobile hamburger menu opens and navigates', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('link', { name: 'My Leads', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'My Leads', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  });

  test('processes a new lead end-to-end through the real pipeline', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/process');
    await page.getByPlaceholder(/Paste Sales Navigator/).fill(PRIYA_SALES_NAV_SAMPLE);
    await page.getByRole('button', { name: 'Process Lead' }).click();

    await expect(page.getByText('Processing…')).toBeVisible();
    const resultPanel = page.getByTestId('processing-result');
    await expect(resultPanel).toBeVisible({ timeout: 30_000 });

    await expect(resultPanel.getByText('Priya Nandakumar.').first()).toBeVisible();
    await expect(resultPanel.getByText('Solstice Robotics').first()).toBeVisible();

    const viewInDashboard = resultPanel.getByRole('link', { name: /View in dashboard/ });
    await expect(viewInDashboard).toBeVisible();
    await viewInDashboard.click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('Priya Nandakumar.')).toBeVisible();

    expect(errors, `Console errors during processing: ${errors.join('; ')}`).toEqual([]);
  });

  test('dashboard search filter narrows the leads table', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Priya Nandakumar.')).toBeVisible();

    await page.getByLabel('Search').fill('Priya');
    await expect(page.getByText('Priya Nandakumar.')).toBeVisible();

    await page.getByLabel('Search').fill('SomeoneWhoDoesNotExist');
    await expect(page.getByText(/No leads found/)).toBeVisible();

    await page.getByRole('button', { name: 'Reset filters' }).click();
    await expect(page.getByText('Priya Nandakumar.')).toBeVisible();
  });

  test('editing approval status in the lead details modal saves successfully', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByText('Priya Nandakumar.').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Approval Status').selectOption('APPROVED');
    await dialog.getByRole('button', { name: 'Save changes' }).click();

    await expect(dialog.getByText('Lead updated successfully')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).not.toBeVisible();

    await page.getByText('Priya Nandakumar.').click();
    await expect(dialog.getByLabel('Approval Status')).toHaveValue('APPROVED');
    await dialog.getByRole('button', { name: 'Close' }).click();
  });

  test('delete flow requires confirmation before removing a lead', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByText('Priya Nandakumar.').click();

    await page.getByRole('button', { name: 'Delete lead' }).click();
    await expect(page.getByText('Delete this lead permanently?')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'Delete lead' }).click();
    await page.getByRole('button', { name: 'Confirm delete' }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText('Priya Nandakumar.')).not.toBeVisible();
  });
});
