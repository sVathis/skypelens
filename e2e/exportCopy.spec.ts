import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { SKYPELENS_E2E_BASE_URL } from "../playwright.config";
import type { DeepLinkTarget } from "../src/utils/deepLink";
import {
  CONVERSATION_ID,
  createSyntheticExport,
  messageIdFor,
} from "../src/__tests__/fixtures/syntheticExport";
import { linkedMessage, markTab, readMark, reportHtml, uploadInput } from "./helpers";

const FINDINGS: DeepLinkTarget[] = [
  { conversationId: CONVERSATION_ID, messageId: messageIdFor(150) },
  { conversationId: CONVERSATION_ID, messageId: messageIdFor(2900) },
  { conversationId: CONVERSATION_ID, messageId: messageIdFor(1200) },
];

test("the report's tab copies the export from a SkypeLens tab the user opened", async ({
  context,
}, testInfo) => {
  const exportPath = testInfo.outputPath("messages.json");
  const reportPath = testInfo.outputPath("report.html");
  await writeFile(exportPath, JSON.stringify(createSyntheticExport(3000).exportData));
  await writeFile(
    reportPath,
    reportHtml(SKYPELENS_E2E_BASE_URL, [
      ...FINDINGS.map((target) => ({ target })),
      // Opens a new tab each time, like report.md links
      { target: FINDINGS[0], tab: "_blank" },
    ]),
  );

  // SkypeLens opened by the user, export loaded there. Report links can't reach this tab.
  const userTab = await context.newPage();
  await userTab.goto(SKYPELENS_E2E_BASE_URL);
  await uploadInput(userTab).setInputFiles(exportPath);
  await expect(userTab.locator(`[data-conversation-id="${CONVERSATION_ID}"]`)).toBeVisible();
  const userTabUrl = userTab.url();

  const report = await context.newPage();
  await report.goto(pathToFileURL(reportPath).href);
  const links = report.locator("a.skypelens-link");

  // The first click opens the report's tab, which copies the export instead of
  // asking for it
  const [reportTab] = await Promise.all([context.waitForEvent("page"), links.nth(0).click()]);
  await expect(linkedMessage(reportTab, FINDINGS[0].messageId)).toBeVisible();
  await expect(uploadInput(reportTab)).toHaveCount(0);
  await markTab(reportTab);

  // Later clicks reuse that tab
  for (let i = 1; i < FINDINGS.length; i++) {
    await links.nth(i).click();
    await expect(linkedMessage(reportTab, FINDINGS[i].messageId)).toBeVisible();
    expect(await readMark(reportTab)).toBe("not reloaded");
  }
  expect(context.pages()).toHaveLength(3);
  // The user's tab kept its place: it didn't navigate to the links
  expect(userTab.url()).toBe(userTabUrl);
  await expect(linkedMessage(userTab, FINDINGS[0].messageId)).toHaveCount(0);

  // A link that opens a new tab each time hands the link over instead of taking
  // another copy of the export
  const [blankTab] = await Promise.all([
    context.waitForEvent("page"),
    links.nth(FINDINGS.length).click(),
  ]);
  await expect(blankTab.getByText("Opened in your other SkypeLens tab")).toBeVisible();
  await expect(uploadInput(blankTab)).toHaveCount(1);
});
