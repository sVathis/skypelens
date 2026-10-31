import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { MainContent } from "../components/Layout/MainContent";
import { useMessageStore } from "../store/messageStore";
import { buildDeepLinkUrl, parseDeepLink } from "../utils/deepLink";
import {
  CONVERSATION_ID,
  GROUP_CONVERSATION_ID,
  createSyntheticExport,
  messageIdFor,
} from "./fixtures/syntheticExport";
import {
  DATE_ROW_HEIGHT,
  MESSAGE_ROW_HEIGHT,
  VIEWPORT_HEIGHT,
  installLayout,
} from "./fixtures/layout";

const COUNT = 10_000;
const initialState = useMessageStore.getState();
const store = () => useMessageStore.getState();
const { exportData, special } = createSyntheticExport(COUNT);

let uninstallLayout: () => void;
let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  uninstallLayout = installLayout();
});
afterAll(() => uninstallLayout());

beforeEach(() => {
  useMessageStore.setState(initialState, true);
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, label: string, timeout = 20_000) {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await sleep(10);
  }
}

function renderApp() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <MantineProvider>
      <MainContent />
    </MantineProvider>,
  );
}

const linkTo = (n: number | string) =>
  buildDeepLinkUrl(
    { conversationId: CONVERSATION_ID, messageId: typeof n === "number" ? messageIdFor(n) : n },
    `${window.location.origin}/`,
  );

/** Simulates the browser opening a URL in this tab without a reload (history entry + popstate). */
function navigateInPage(url: string) {
  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const container = () =>
  document.querySelector<HTMLElement>("[data-message-scroll-container]")!;
const rowOf = (messageId: string) =>
  document
    .querySelector(`[data-message-id="${messageId}"]`)
    ?.closest<HTMLElement>("[data-index]") ?? null;
const highlighted = () => document.querySelector<HTMLElement>(".skypelens-deeplink-target");
const text = () => document.body.textContent ?? "";

async function waitForNavigation(messageId: string) {
  await waitFor(
    () =>
      store().navigationTarget?.messageId === messageId &&
      store().navigationTarget?.status === "done",
    `navigation to ${messageId}`,
  );
}

/** Asserts the row is where virtualizer.scrollToIndex(index, { align: "center" }) puts it. */
function expectCentered(displayedId: string) {
  const row = rowOf(displayedId);
  expect(row, `row for ${displayedId} rendered`).not.toBeNull();
  const sizer = row!.parentElement!;
  const totalSize = parseFloat(sizer.style.height) - 24;
  const maxOffset = Math.max(0, totalSize - VIEWPORT_HEIGHT);
  const top = parseFloat(row!.style.top);
  const expected = Math.max(
    0,
    Math.min(maxOffset, top + MESSAGE_ROW_HEIGHT / 2 - VIEWPORT_HEIGHT / 2),
  );
  expect(Math.abs(container().scrollTop - expected)).toBeLessThanOrEqual(1);
  // The row is inside the viewport
  expect(top).toBeGreaterThanOrEqual(container().scrollTop);
  expect(top + MESSAGE_ROW_HEIGHT).toBeLessThanOrEqual(container().scrollTop + VIEWPORT_HEIGHT);
}

async function renderWithExport() {
  store().setExportData(exportData);
  renderApp();
  await waitFor(() => document.querySelectorAll("[data-message-id]").length > 0, "messages");
}

function clickIcon(iconClass: string) {
  const button = document.querySelector(`.${iconClass}`)?.closest("button");
  expect(button, iconClass).toBeTruthy();
  button!.click();
}

describe("deep-link navigation in the message view", () => {
  it("opens a link before the export is loaded and jumps thousands of messages back", async () => {
    const n = 2_500; // raw index 7,499: far outside the initial 50 messages
    window.history.replaceState(null, "", linkTo(n));
    renderApp();

    await waitFor(() => text().includes("Load the export to open this link"), "upload notice");
    expect(text()).toContain(CONVERSATION_ID);
    expect(store().pendingDeepLink?.messageId).toBe(messageIdFor(n));

    // What FileUpload does once the user has picked the export
    store().setExportData(exportData);
    await waitForNavigation(messageIdFor(n));

    expect(highlighted()?.dataset.messageId).toBe(messageIdFor(n));
    expect(highlighted()?.className).toContain("skypelens-deeplink-flash");
    expectCentered(messageIdFor(n));
    // Surrounding conversation is rendered on both sides
    for (const neighbour of [n - 4, n - 1, n + 1, n + 4]) {
      expect(rowOf(messageIdFor(neighbour)), `neighbour ${neighbour}`).not.toBeNull();
    }

    // Auto-scroll-to-bottom and load-more must not take over afterwards
    await sleep(800);
    expectCentered(messageIdFor(n));
    expect(window.location.search).toContain("messageId=");
  });

  it("navigates within a loaded export, to the earliest and latest messages, with Back/Forward", async () => {
    await renderWithExport();
    await waitFor(() => container().scrollTop > 0, "initial scroll to bottom");

    navigateInPage(linkTo(0));
    await waitForNavigation(messageIdFor(0));
    expect(highlighted()?.dataset.messageId).toBe(messageIdFor(0));
    expectCentered(messageIdFor(0));
    expect(container().scrollTop).toBeLessThanOrEqual(DATE_ROW_HEIGHT);

    navigateInPage(linkTo(COUNT - 1));
    await waitForNavigation(messageIdFor(COUNT - 1));
    expect(highlighted()?.dataset.messageId).toBe(messageIdFor(COUNT - 1));
    expectCentered(messageIdFor(COUNT - 1));
    // Only one message is highlighted at a time
    expect(document.querySelectorAll(".skypelens-deeplink-target")).toHaveLength(1);

    window.history.back();
    await waitForNavigation(messageIdFor(0));
    expectCentered(messageIdFor(0));

    window.history.forward();
    await waitForNavigation(messageIdFor(COUNT - 1));
    expectCentered(messageIdFor(COUNT - 1));
  });

  it("is not overridden by the scroll-to-bottom of a conversation it just opened", async () => {
    // A small conversation processes almost instantly, so navigation settles before the
    // scroll-to-bottom of the newly opened conversation would fire.
    await renderWithExport();
    store().selectConversation(CONVERSATION_ID);
    await waitFor(() => container().scrollTop > 0, "main conversation at bottom");
    const groupMessageId = exportData.conversations[0].MessageList[90].id;
    navigateInPage(
      buildDeepLinkUrl(
        { conversationId: GROUP_CONVERSATION_ID, messageId: groupMessageId },
        `${window.location.origin}/`,
      ),
    );
    await waitForNavigation(groupMessageId);
    expectCentered(groupMessageId);
    await sleep(800);
    expectCentered(groupMessageId);
  });

  it("shows an error for unknown conversations and messages instead of guessing", async () => {
    await renderWithExport();

    navigateInPage(
      buildDeepLinkUrl({ conversationId: "8:live:not-in-export", messageId: "1" }, `${window.location.origin}/`),
    );
    await waitFor(() => text().includes("Could not open link"), "conversation error");
    expect(text()).toContain("8:live:not-in-export");
    expect(highlighted()).toBeNull();

    navigateInPage(linkTo("1234"));
    await waitFor(() => text().includes('Message "1234" was not found'), "message error");
    expect(highlighted()).toBeNull();
    expect(store().selectedConversationId).toBe(CONVERSATION_ID);
  });

  it("clears an active search, works with swapped roles and keeps the target across a swap", async () => {
    await renderWithExport();
    navigateInPage(buildDeepLinkUrl({ conversationId: CONVERSATION_ID, messageId: null }, `${window.location.origin}/`));
    await waitFor(() => store().selectedConversationId === CONVERSATION_ID, "conversation");

    clickIcon("tabler-icon-arrows-exchange");
    await waitFor(() => store().isRoleSwapped(CONVERSATION_ID), "role swap");

    clickIcon("tabler-icon-search");
    const input = await (async () => {
      await waitFor(() => !!document.querySelector('input[placeholder="Search messages..."]'), "search input");
      return document.querySelector<HTMLInputElement>('input[placeholder="Search messages..."]')!;
    })();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "no-such-text");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(() => text().includes("No messages found"), "search filter applied");

    const n = 6_000;
    navigateInPage(linkTo(n));
    await waitForNavigation(messageIdFor(n));
    expect(input.value).toBe("");
    expect(highlighted()?.dataset.messageId).toBe(messageIdFor(n));
    expectCentered(messageIdFor(n));

    // Swapping back keeps the linked message in view instead of jumping to the bottom
    clickIcon("tabler-icon-arrows-exchange");
    await waitFor(() => !store().isRoleSwapped(CONVERSATION_ID), "swap back");
    await waitForNavigation(messageIdFor(n));
    await sleep(500);
    expectCentered(messageIdFor(n));
  });

  it("highlights the displayed bubble for merged and hidden messages, with an explanation", async () => {
    await renderWithExport();

    navigateInPage(linkTo(special.ownerTranslationId));
    await waitForNavigation(special.ownerTranslationId);
    expect(highlighted()?.dataset.messageId).toBe(special.ownerTranslationOriginalId);
    expect(text()).toContain("part of a translation pair");
    expectCentered(special.ownerTranslationOriginalId);

    navigateInPage(linkTo(special.otherTranslationOriginalId));
    await waitForNavigation(special.otherTranslationOriginalId);
    expect(highlighted()?.dataset.messageId).toBe(special.otherTranslationId);

    navigateInPage(linkTo(special.albumId));
    await waitForNavigation(special.albumId);
    const row = highlighted();
    expect(row?.dataset.messageId).not.toBe(special.albumId);
    expect(row?.className).toContain("skypelens-deeplink-approximate");
    expect(text()).toContain('"RichText/Media_Album") is not displayed');
  });

  it("copies a permalink that resolves back to the same message", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await renderWithExport();

    const n = 4_321;
    navigateInPage(linkTo(n));
    await waitForNavigation(messageIdFor(n));

    highlighted()!.querySelector<HTMLButtonElement>('[aria-label="Copy link to message"]')!.click();
    await waitFor(() => writeText.mock.calls.length === 1, "clipboard write");
    const copied = new URL(writeText.mock.calls[0][0] as string);
    expect(copied.origin + copied.pathname).toBe(`${window.location.origin}/`);
    expect(parseDeepLink(copied.search)).toEqual({
      kind: "valid",
      target: { conversationId: CONVERSATION_ID, messageId: messageIdFor(n) },
    });
    await waitFor(() => text().includes("Link copied"), "copy feedback");
  });

  it("stays responsive with 12,000 messages", async () => {
    const big = createSyntheticExport(12_000).exportData;
    const n = 300; // raw index 11,699
    window.history.replaceState(null, "", linkTo(n));
    renderApp();
    await waitFor(() => store().pendingDeepLink !== null, "pending link");

    const start = performance.now();
    store().setExportData(big);
    await waitForNavigation(messageIdFor(n));
    const elapsed = performance.now() - start;

    expectCentered(messageIdFor(n));
    // Only a window of rows is in the DOM, not 12,000
    expect(document.querySelectorAll("[data-index]").length).toBeLessThan(80);
    console.info(`[perf] 12,000-message deep link resolved in ${elapsed.toFixed(0)}ms (jsdom)`);
    expect(elapsed).toBeLessThan(10_000);
  });
});
