import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { SKYPELENS_E2E_BASE_URL } from "../playwright.config";
import type { DeepLinkTarget } from "../src/utils/deepLink";
import {
  CONVERSATION_ID,
  GROUP_CONVERSATION_ID,
  createSyntheticExport,
  messageIdFor,
} from "../src/__tests__/fixtures/syntheticExport";

const MESSAGE_COUNT = 3000;

const FINDINGS: DeepLinkTarget[] = [
  { conversationId: CONVERSATION_ID, messageId: messageIdFor(150) },
  { conversationId: CONVERSATION_ID, messageId: messageIdFor(2900) },
  { conversationId: GROUP_CONVERSATION_ID, messageId: messageIdFor(40) },
  { conversationId: CONVERSATION_ID, messageId: messageIdFor(1200) },
];

// Built like tools/skypelens_links.py does (base URL kept byte for byte, IDs in the
// hash), independently of SkypeLens' own buildDeepLinkUrl
const pythonStyleUrl = (baseUrl: string, { conversationId, messageId }: DeepLinkTarget) =>
  `${baseUrl}#conversationId=${encodeURIComponent(conversationId)}&messageId=${encodeURIComponent(messageId ?? "")}`;

// The markup of finding_links_html() (its tests pin it): a named target and no
// rel="noopener"/"noreferrer"
function reportHtml(baseUrl: string) {
  const links = FINDINGS.map((target) => {
    const href = pythonStyleUrl(baseUrl, target).replaceAll("&", "&amp;");
    return `<li><a class="skypelens-link" href="${href}" target="skypelens">View in SkypeLens</a></li>`;
  });
  return `<!doctype html><meta charset="utf-8"><title>Synthetic report</title><ul>${links.join("")}</ul>`;
}

const linkedMessage = (page: Page, messageId: string | null) =>
  page.locator(`[data-deeplink-target][data-message-id="${messageId}"]`);
const uploadInput = (page: Page) => page.locator('input[type="file"][accept]');
const beforeHash = (url: string) => url.split("#")[0];

// Survives only as long as the tab is never reloaded
const markTab = (page: Page) =>
  page.evaluate(() => ((window as Window & { e2eMarker?: string }).e2eMarker = "not reloaded"));
const readMark = (page: Page) =>
  page.evaluate(() => (window as Window & { e2eMarker?: string }).e2eMarker);

for (const baseUrl of [
  SKYPELENS_E2E_BASE_URL,
  // SkypeLens rewrites its own URL when a conversation is opened from the sidebar; the
  // query must keep "%20" (not "+") so that it still matches the report links
  `${SKYPELENS_E2E_BASE_URL}?note=a%20b`,
]) {
  test(`report links reuse one SkypeLens tab and keep the loaded export (${baseUrl})`, async ({
    context,
    page: report,
  }, testInfo) => {
    const exportPath = testInfo.outputPath("messages.json");
    const reportPath = testInfo.outputPath("report.html");
    await writeFile(exportPath, JSON.stringify(createSyntheticExport(MESSAGE_COUNT).exportData));
    await writeFile(reportPath, reportHtml(baseUrl));

    let openedPages = 0;
    context.on("page", () => openedPages++);

    // report.html is opened from the filesystem
    await report.goto(pathToFileURL(reportPath).href);
    const links = report.locator("a.skypelens-link");

    // The first click opens the named tab, where the export is loaded once
    const [skypeLens] = await Promise.all([context.waitForEvent("page"), links.nth(0).click()]);
    await uploadInput(skypeLens).setInputFiles(exportPath);
    await expect(linkedMessage(skypeLens, FINDINGS[0].messageId)).toBeVisible();
    await markTab(skypeLens);

    for (let i = 1; i < FINDINGS.length; i++) {
      if (i === 2) {
        // Opening a conversation from the sidebar makes SkypeLens write its own URL
        await skypeLens.locator(`[data-conversation-id="${GROUP_CONVERSATION_ID}"]`).click();
        expect(beforeHash(skypeLens.url())).toBe(beforeHash(await links.nth(i).getAttribute("href") ?? ""));
      }

      await links.nth(i).click();
      await expect(linkedMessage(skypeLens, FINDINGS[i].messageId)).toBeVisible();
      await expect(linkedMessage(skypeLens, FINDINGS[i - 1].messageId)).toHaveCount(0);
      expect(new URL(skypeLens.url()).hash).toContain(`messageId=${FINDINGS[i].messageId}`);

      // Same tab, same page: no new tab, no reload, no upload screen
      expect(openedPages).toBe(1);
      expect(context.pages()).toHaveLength(2);
      expect(await readMark(skypeLens)).toBe("not reloaded");
      await expect(uploadInput(skypeLens)).toHaveCount(0);
    }
  });
}
