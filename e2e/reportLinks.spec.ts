import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { SKYPELENS_E2E_BASE_URL } from "../playwright.config";
import type { DeepLinkTarget } from "../src/utils/deepLink";
import {
  CONVERSATION_ID,
  GROUP_CONVERSATION_ID,
  createSyntheticExport,
  messageIdFor,
} from "../src/__tests__/fixtures/syntheticExport";
import { beforeHash, linkedMessage, markTab, readMark, reportHtml, uploadInput } from "./helpers";

const MESSAGE_COUNT = 3000;

const FINDINGS: DeepLinkTarget[] = [
  { conversationId: CONVERSATION_ID, messageId: messageIdFor(150) },
  { conversationId: CONVERSATION_ID, messageId: messageIdFor(2900) },
  { conversationId: GROUP_CONVERSATION_ID, messageId: messageIdFor(40) },
  { conversationId: CONVERSATION_ID, messageId: messageIdFor(1200) },
];

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
    await writeFile(reportPath, reportHtml(baseUrl, FINDINGS.map((target) => ({ target }))));

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

    // Clicking the same finding again after scrolling away goes back to it, although the
    // URL doesn't change (no "hashchange")
    const last = FINDINGS.length - 1;
    const lastMessage = linkedMessage(skypeLens, FINDINGS[last].messageId);
    await expect(lastMessage).toBeInViewport();
    await skypeLens
      .locator("[data-message-scroll-container]")
      .evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(lastMessage).not.toBeInViewport();

    await links.nth(last).click();
    await expect(lastMessage).toBeInViewport();
    expect(openedPages).toBe(1);
    expect(await readMark(skypeLens)).toBe("not reloaded");
  });
}
