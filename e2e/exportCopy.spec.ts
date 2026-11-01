import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { SKYPELENS_E2E_BASE_URL } from "../playwright.config";
import type { DeepLinkTarget } from "../src/utils/deepLink";
import type { SkypeExport } from "../src/types/messages";
import {
  CONVERSATION_ID,
  OTHER_ID,
  createSyntheticConversation,
  createSyntheticExport,
  messageIdFor,
} from "../src/__tests__/fixtures/syntheticExport";
import { linkedMessage, markTab, readMark, reportHtml, uploadInput } from "./helpers";

const FINDINGS: DeepLinkTarget[] = [
  { conversationId: CONVERSATION_ID, messageId: messageIdFor(150) },
  { conversationId: CONVERSATION_ID, messageId: messageIdFor(2900) },
  { conversationId: CONVERSATION_ID, messageId: messageIdFor(1200) },
];

// --- Synthetic export folder with media -----------------------------------------------

// A real 1x1 PNG and a small file, as a Skype export's media/ folder holds them
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF_BYTES = Buffer.from("%PDF-1.4\n% synthetic attachment, no real content\n%%EOF\n");
const PHOTO_ID = "0-weu-d1-syntheticphoto";
const FILE_ID = "0-weu-d1-syntheticnotes";
// Small, as Playwright uploads folders slowly in Firefox
const MEDIA_EXPORT_MESSAGES = 300;
const PHOTO_MESSAGE = messageIdFor(290);
const FILE_MESSAGE = messageIdFor(291);

/** Writes a Skype-like export folder (messages.json plus media/) with two attachments. */
async function writeExportFolder(testInfo: TestInfo): Promise<string> {
  const exportData = createSyntheticExport(MEDIA_EXPORT_MESSAGES).exportData as SkypeExport;
  const conversation = exportData.conversations.find((c) => c.id === CONVERSATION_ID)!;
  const replace = (messageId: string, messagetype: string, mediaId: string, name: string) => {
    const message = conversation.MessageList.find((m) => m.id === messageId)!;
    Object.assign(message, {
      from: OTHER_ID,
      messagetype,
      content: `<URIObject type="File.1" uri="https://api.asm.skype.com/v1/objects/${mediaId}"><OriginalName v="${name}"></OriginalName></URIObject>`,
    });
  };
  replace(PHOTO_MESSAGE, "RichText/UriObject", PHOTO_ID, "synthetic-photo.png");
  // Not an image or video: SkypeLens shows it as a link that downloads the file
  replace(FILE_MESSAGE, "RichText/UriObject", FILE_ID, "synthetic-notes.pdf");

  const folder = testInfo.outputPath("export");
  await mkdir(join(folder, "media"), { recursive: true });
  await writeFile(join(folder, "messages.json"), JSON.stringify(exportData));
  const metadata = (filename: string) =>
    JSON.stringify({ expiry_date: "2099-01-01T00:00:00Z", filename, contents: {} });
  await writeFile(join(folder, "media", `${PHOTO_ID}.json`), metadata("synthetic-photo.png"));
  await writeFile(join(folder, "media", `${PHOTO_ID}.1.png`), PNG_BYTES);
  await writeFile(join(folder, "media", `${FILE_ID}.json`), metadata("synthetic-notes.pdf"));
  await writeFile(join(folder, "media", `${FILE_ID}.1.pdf`), PDF_BYTES);
  return folder;
}

/** Every media file a tab has loaded: key, name, size, MIME type and bytes. */
function mediaFiles(page: Page) {
  return page.evaluate(async () => {
    type Store = { getState: () => { exportData: SkypeExport | null } };
    const store = (window as unknown as { __SKYPELENS_STORE__: Store }).__SKYPELENS_STORE__;
    const files = store.getState().exportData?.mediaFiles ?? new Map<string, File>();
    return Promise.all(
      [...files].map(async ([key, file]) => ({
        key,
        isFile: file instanceof File,
        name: file.name,
        size: file.size,
        type: file.type,
        bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
      })),
    );
  });
}

// --- Flow helpers -------------------------------------------------------------------

/** SkypeLens opened by the user, with an export loaded. Report links can't reach it. */
async function openUserTab(context: BrowserContext, load: (page: Page) => Promise<void>) {
  const userTab = await context.newPage();
  await userTab.goto(SKYPELENS_E2E_BASE_URL);
  await load(userTab);
  await expect(userTab.locator(`[data-conversation-id="${CONVERSATION_ID}"]`)).toBeVisible();
  return userTab;
}

async function openReport(context: BrowserContext, testInfo: TestInfo, links: Parameters<typeof reportHtml>[1]) {
  const reportPath = testInfo.outputPath("report.html");
  await writeFile(reportPath, reportHtml(SKYPELENS_E2E_BASE_URL, links));
  const report = await context.newPage();
  await report.goto(pathToFileURL(reportPath).href);
  return report.locator("a.skypelens-link");
}

/** Waits until both tabs show the same code, then answers in the user's tab. */
async function answerCopyRequest(reportTab: Page, userTab: Page, allow: boolean) {
  const code = (await reportTab.locator("[data-export-copy-code]").textContent())?.trim();
  expect(code).toMatch(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/);
  await expect(userTab.locator("[data-export-approval-code]")).toHaveText(code!);
  await userTab.getByRole("button", { name: allow ? "Allow copy" : "Don't allow" }).click();
  await expect(userTab.locator("[data-export-approval-code]")).toHaveCount(0);
}

test("the report's tab copies the export from a SkypeLens tab the user opened, once allowed", async ({
  context,
}, testInfo) => {
  const exportPath = testInfo.outputPath("messages.json");
  await writeFile(exportPath, JSON.stringify(createSyntheticExport(3000).exportData));
  const userTab = await openUserTab(context, (page) => uploadInput(page).setInputFiles(exportPath));
  const userTabUrl = userTab.url();
  const links = await openReport(context, testInfo, [
    ...FINDINGS.map((target) => ({ target })),
    // Opens a new tab each time, like report.md links
    { target: FINDINGS[0], tab: "_blank" },
  ]);

  // The first click opens the report's tab, which asks the user's tab for a copy
  const [reportTab] = await Promise.all([context.waitForEvent("page"), links.nth(0).click()]);
  await answerCopyRequest(reportTab, userTab, true);
  await expect(linkedMessage(reportTab, FINDINGS[0].messageId)).toBeVisible();
  await expect(uploadInput(reportTab)).toHaveCount(0);
  await markTab(reportTab);

  // Later clicks reuse that tab
  for (let i = 1; i < FINDINGS.length; i++) {
    await links.nth(i).click();
    await expect(linkedMessage(reportTab, FINDINGS[i].messageId)).toBeVisible();
    expect(await readMark(reportTab)).toBe("not reloaded");
  }
  // Clicking the same finding again still works
  await links.nth(FINDINGS.length - 1).click();
  await expect(linkedMessage(reportTab, FINDINGS[FINDINGS.length - 1].messageId)).toBeInViewport();
  expect(context.pages()).toHaveLength(3);

  // The user's tab kept its place and its export, and still works
  expect(userTab.url()).toBe(userTabUrl);
  await expect(linkedMessage(userTab, FINDINGS[0].messageId)).toHaveCount(0);
  await userTab.locator(`[data-conversation-id="${CONVERSATION_ID}"]`).click();
  await expect(userTab.locator("[data-message-id]").first()).toBeVisible();

  // A link that opens a new tab each time hands the link over, without asking for a copy
  const [blankTab] = await Promise.all([
    context.waitForEvent("page"),
    links.nth(FINDINGS.length).click(),
  ]);
  await expect(blankTab.getByText("Opened in your other SkypeLens tab")).toBeVisible();
  await expect(uploadInput(blankTab)).toHaveCount(1);
  await expect(userTab.locator("[data-export-approval-code]")).toHaveCount(0);
});

test("media files survive the copy and open in the report's tab", async ({ context }, testInfo) => {
  const folder = await writeExportFolder(testInfo);
  const userTab = await openUserTab(context, (page) =>
    page.locator('input[type="file"][webkitdirectory]').setInputFiles(folder),
  );
  const original = await mediaFiles(userTab);
  expect(original.map((file) => file.key).sort()).toEqual(
    // Each attachment under its file name, and under its name without extension
    [
      `${FILE_ID}.1`,
      `${FILE_ID}.1.pdf`,
      `${FILE_ID}.json`,
      `${PHOTO_ID}.1`,
      `${PHOTO_ID}.1.png`,
      `${PHOTO_ID}.json`,
    ].sort(),
  );

  const links = await openReport(context, testInfo, [
    { target: { conversationId: CONVERSATION_ID, messageId: PHOTO_MESSAGE } },
  ]);
  const [reportTab] = await Promise.all([context.waitForEvent("page"), links.nth(0).click()]);
  await answerCopyRequest(reportTab, userTab, true);
  await expect(linkedMessage(reportTab, PHOTO_MESSAGE)).toBeVisible();

  // Same entries, names, sizes, MIME types and bytes as in the user's tab. (The MIME
  // type is whatever the browser gave the uploaded file: "image/png" in Chromium, ""
  // for folder uploads in Firefox.)
  const copied = await mediaFiles(reportTab);
  expect(copied).toEqual(original);
  const photo = copied.find((file) => file.key === `${PHOTO_ID}.1.png`)!;
  expect(photo).toMatchObject({ isFile: true, name: `${PHOTO_ID}.1.png`, size: PNG_BYTES.length });
  expect(photo.bytes).toEqual([...PNG_BYTES]);

  // The image is displayed from the copied file
  const image = reportTab.locator('img[alt="synthetic-photo.png"]');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

  // The attachment opens (downloads) with its original name and bytes
  const attachment = reportTab.getByRole("link", { name: /synthetic-notes\.pdf/ });
  await attachment.scrollIntoViewIfNeeded();
  const [download] = await Promise.all([reportTab.waitForEvent("download"), attachment.click()]);
  expect(download.suggestedFilename()).toBe("synthetic-notes.pdf");
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks)).toEqual(PDF_BYTES);
});

test("a newer link held by another tab replaces a copy waiting for approval", async ({
  context,
}, testInfo) => {
  // Two tabs the user opened, each with a different export
  const SECOND_CONVERSATION = "8:live:.cid.synthetic-second";
  const firstPath = testInfo.outputPath("first.json");
  const secondPath = testInfo.outputPath("second.json");
  await writeFile(firstPath, JSON.stringify(createSyntheticExport(300).exportData));
  const second: SkypeExport = {
    userId: "8:live:.cid.synthetic-owner",
    exportDate: "2024-12-31T00:00:00.000Z",
    conversations: [createSyntheticConversation(300, SECOND_CONVERSATION).conversation],
  };
  await writeFile(secondPath, JSON.stringify(second));
  const firstTab = await openUserTab(context, (page) => uploadInput(page).setInputFiles(firstPath));
  const secondTab = await context.newPage();
  await secondTab.goto(SKYPELENS_E2E_BASE_URL);
  await uploadInput(secondTab).setInputFiles(secondPath);
  await expect(secondTab.locator(`[data-conversation-id="${SECOND_CONVERSATION}"]`)).toBeVisible();

  const inFirst = { conversationId: CONVERSATION_ID, messageId: messageIdFor(100) };
  const inSecond = { conversationId: SECOND_CONVERSATION, messageId: messageIdFor(200) };
  const links = await openReport(context, testInfo, [{ target: inFirst }, { target: inSecond }]);

  // Two findings clicked in quick succession, before anyone answers
  const [reportTab] = await Promise.all([context.waitForEvent("page"), links.nth(0).click()]);
  await expect(firstTab.locator("[data-export-approval-code]")).toBeVisible();
  await links.nth(1).click();

  // The first tab's question is withdrawn; the second tab is asked instead
  await expect(firstTab.locator("[data-export-approval-code]")).toHaveCount(0);
  await answerCopyRequest(reportTab, secondTab, true);
  await expect(linkedMessage(reportTab, inSecond.messageId)).toBeVisible();
  await expect(reportTab.locator(`[data-conversation-id="${CONVERSATION_ID}"]`)).toHaveCount(0);
});

test("a link that no tab has drops a copy still waiting for approval", async ({
  context,
}, testInfo) => {
  const exportPath = testInfo.outputPath("messages.json");
  await writeFile(exportPath, JSON.stringify(createSyntheticExport(300).exportData));
  const userTab = await openUserTab(context, (page) => uploadInput(page).setInputFiles(exportPath));
  const inExport = { conversationId: CONVERSATION_ID, messageId: messageIdFor(100) };
  const notLoaded = { conversationId: "8:live:.cid.synthetic-not-loaded", messageId: messageIdFor(5) };
  const links = await openReport(context, testInfo, [{ target: inExport }, { target: notLoaded }]);

  const [reportTab] = await Promise.all([context.waitForEvent("page"), links.nth(0).click()]);
  await expect(userTab.locator("[data-export-approval-code]")).toBeVisible();
  await links.nth(1).click();

  // No tab claims the newer link, so the question for the older one is withdrawn
  await expect(userTab.locator("[data-export-approval-code]")).toHaveCount(0, { timeout: 20_000 });
  await expect(reportTab.getByText(/None of your other SkypeLens tabs has the export/)).toBeVisible();
  await expect(uploadInput(reportTab)).toHaveCount(1);
  // The report's tab keeps the newest link, and has no export
  const hash = new URLSearchParams(new URL(reportTab.url()).hash.slice(1));
  expect(hash.get("conversationId")).toBe(notLoaded.conversationId);
  expect(hash.get("messageId")).toBe(notLoaded.messageId);
  expect(await reportTab.evaluate(() => {
    type Store = { getState: () => { exportData: unknown } };
    return (window as unknown as { __SKYPELENS_STORE__: Store }).__SKYPELENS_STORE__.getState().exportData;
  })).toBeNull();
});

test("nothing is copied when the user doesn't allow it", async ({ context }, testInfo) => {
  const exportPath = testInfo.outputPath("messages.json");
  await writeFile(exportPath, JSON.stringify(createSyntheticExport(300).exportData));
  const userTab = await openUserTab(context, (page) => uploadInput(page).setInputFiles(exportPath));
  const links = await openReport(context, testInfo, [
    { target: { conversationId: CONVERSATION_ID, messageId: messageIdFor(100) } },
  ]);

  const [reportTab] = await Promise.all([context.waitForEvent("page"), links.nth(0).click()]);
  await answerCopyRequest(reportTab, userTab, false);

  await expect(reportTab.getByText("The copy was declined in your other SkypeLens tab.")).toBeVisible();
  await expect(uploadInput(reportTab)).toHaveCount(1);
  expect(await reportTab.evaluate(() => {
    type Store = { getState: () => { exportData: unknown } };
    return (window as unknown as { __SKYPELENS_STORE__: Store }).__SKYPELENS_STORE__.getState().exportData;
  })).toBeNull();
});

test("a copy that fails is reported instead of staying in progress", async ({ context }, testInfo) => {
  const exportPath = testInfo.outputPath("messages.json");
  await writeFile(exportPath, JSON.stringify(createSyntheticExport(300).exportData));
  const userTab = await openUserTab(context, (page) => uploadInput(page).setInputFiles(exportPath));
  // Make the export impossible to clone, as an export too large for memory would be
  await userTab.evaluate(() => {
    type Store = {
      setState: (update: (state: { exportData: object }) => { exportData: object }) => void;
    };
    const store = (window as unknown as { __SKYPELENS_STORE__: Store }).__SKYPELENS_STORE__;
    store.setState((state) => ({ exportData: { ...state.exportData, cannotClone: () => 0 } }));
  });
  const links = await openReport(context, testInfo, [
    { target: { conversationId: CONVERSATION_ID, messageId: messageIdFor(100) } },
  ]);

  const [reportTab] = await Promise.all([context.waitForEvent("page"), links.nth(0).click()]);
  await answerCopyRequest(reportTab, userTab, true);

  await expect(reportTab.getByText(/could not copy its export/)).toBeVisible();
  await expect(reportTab.getByText("Copying your export from your other SkypeLens tab…")).toHaveCount(0);
  await expect(uploadInput(reportTab)).toHaveCount(1);
});
