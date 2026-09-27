import { test, expect, type Page } from '@playwright/test';
import { usePhotoCamera } from './photo-fixture';

async function setup(host: Page, guest: Page) {
  await host.goto('/');
  await host.getByLabel('What should we call you?').fill('K');
  await host.getByRole('button', { name: 'Open our booth' }).click();
  const invite = host.getByLabel('Private invitation link');
  await expect(invite).toBeVisible();
  await guest.goto(await invite.inputValue());
  await guest.getByLabel('What should we call you?').fill('D');
  await guest.getByRole('button', { name: 'Join the booth' }).click();
  await host.getByRole('button', { name: 'Let them in' }).click();
  await host.getByRole('button', { name: 'Turn on camera', exact: true }).first().click();
  await guest.getByRole('button', { name: 'Turn on camera', exact: true }).first().click();
  await expect(host.getByText('You’re both here')).toBeVisible();
  await expect(guest.getByText('You’re both here')).toBeVisible();
}
async function shoot(host: Page, guest: Page, keep: boolean) {
  await host.getByRole('button', { name: 'I’m ready', exact: true }).click();
  await guest.getByRole('button', { name: 'I’m ready', exact: true }).click();
  await host.getByRole('button', { name: 'Take a photo' }).click();
  await expect(host.getByRole('button', { name: 'Keep this one' })).toBeVisible({ timeout: 40000 });
  await expect(guest.getByRole('button', { name: 'Keep this one' })).toBeVisible();
  const hash = async (page: Page) => {
    const photo = page.getByRole('img', { name: 'Your captured photo', exact: true });
    await expect(photo).toBeVisible();
    return photo.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).join(',');
    });
  };
  expect(await hash(host)).toBe(await hash(guest));
  await host.getByRole('button', { name: keep ? 'Keep this one' : 'Retake', exact: true }).click();
  await expect(host.getByRole('button', { name: 'Keep this one' })).toHaveCount(0);
}
test('two people capture, retake, alternate, decorate and export four photos', async ({
  browser,
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const guestContext = await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1280, height: 900 },
  });
  const guest = await guestContext.newPage();
  guest.on('pageerror', (e) => errors.push(e.message));
  if (process.env.PHOTO_FIXTURE === '1') {
    await usePhotoCamera(page, 0);
    await usePhotoCamera(guest, 1);
  }
  await setup(page, guest);
  await page.getByRole('button', { name: 'Booth settings' }).click();
  await expect(page.getByLabel('Remove backgrounds on this device')).toBeChecked();
  // Wait for the actual model to run, without accepting an automatic fallback.
  await page.waitForTimeout(6000);
  await expect(page.getByLabel('Remove backgrounds on this device')).toBeChecked();
  await page.getByLabel('Effect', { exact: true }).selectOption('mono');
  await guest.getByRole('button', { name: 'Booth settings' }).click();
  await expect(guest.getByLabel('Effect', { exact: true })).toHaveValue('mono');
  await expect(guest.getByLabel('Effect', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Surprise us' }).click();
  await expect(guest.getByRole('button', { name: 'Surprise us' })).toBeDisabled();
  await shoot(page, guest, false);
  await expect(page.getByRole('button', { name: 'Decorate photo 1' })).toHaveCount(0);
  for (let i = 0; i < 4; i++) {
    await shoot(page, guest, true);
    await expect(
      page.getByRole('button', { name: `Decorate photo ${i + 1}`, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Surprise us' })).toBeEnabled();
  await page.getByRole('button', { name: 'Print finish', exact: true }).click();
  await page.getByLabel('Border', { exact: true }).selectOption('cherry');
  await page.getByLabel('Finish', { exact: true }).selectOption('dated');
  await page.getByRole('button', { name: 'Decorate photo 1', exact: true }).click();
  await guest.getByRole('button', { name: 'Decorate photo 1', exact: true }).click();
  await page.getByLabel('Photo caption').fill('Our little moment');
  await page.getByRole('button', { name: 'Add caption' }).click();
  await expect(guest.getByText('Our little moment', { exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'Heart', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove ♥', exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'Move ♥ left', exact: true }).click();
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const bounds = await page.getByLabel('Photo decoration canvas').boundingBox();
  if (!bounds) throw new Error('Decoration canvas missing');
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.9);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.9, {
    steps: 12,
  });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const individualDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save this photo', exact: true }).click();
  expect((await individualDownload).suggestedFilename()).toBe('kdphotobooth-photo.png');
  await page.getByRole('button', { name: 'Close decorations' }).click();
  await guest.getByRole('button', { name: 'Close decorations' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save photo strip' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('kdphotobooth-strip.png');
  await download.saveAs('work/test-strip.png');
  await page.screenshot({ path: 'work/booth-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
  await guestContext.close();
});
test('mobile entry fits and remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open our booth' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'work/entry-mobile.png', fullPage: true });
  await page.getByLabel('What should we call you?').fill('Mobile');
  await page.getByRole('button', { name: 'Open our booth' }).click();
  await expect(page.getByRole('button', { name: 'Copy invitation' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByText('Turn on your camera when you’re ready to step in.')).toBeVisible();
  const cameraButton = page.getByRole('button', { name: 'Turn on camera', exact: true }).first();
  const contrast = await cameraButton.evaluate((button) => {
    const style = getComputedStyle(button);
    const luminance = (rgb: string) => {
      const channels = rgb
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const text = luminance(style.color);
    return Math.min(
      ...style.backgroundImage.match(/rgb\([^)]+\)/g)!.map((color) => {
        const background = luminance(color);
        return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
      }),
    );
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  const poseToggle = page.locator('.mobile-reference-toggle');
  await poseToggle.click();
  const sheet = page.getByRole('dialog', { name: 'Strike a pose.' });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await sheet.getByRole('button', { name: 'Memes', exact: true }).click();
  await expect(sheet.getByLabel('Pose category')).toHaveValue('Meme recreations');
  await sheet
    .getByRole('button', { name: /^Choose / })
    .first()
    .click();
  await page.screenshot({ path: 'work/refined-mobile-poses.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(sheet).not.toBeVisible();
  await expect(poseToggle).toBeFocused();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const buttonBounds = await cameraButton.boundingBox();
  const stageBounds = await page.locator('.stage').boundingBox();
  expect(buttonBounds).not.toBeNull();
  expect(stageBounds).not.toBeNull();
  expect(buttonBounds!.y + buttonBounds!.height).toBeLessThanOrEqual(
    stageBounds!.y + stageBounds!.height,
  );
  await page.screenshot({ path: 'work/refined-mobile-booth.png', fullPage: true });
});
