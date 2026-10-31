import { beforeEach, describe, expect, it } from "vitest";
import { useMessageStore } from "../store/messageStore";
import { applyLocationToStore } from "../hooks/useDeepLinkNavigation";
import {
  CONVERSATION_ID,
  GROUP_CONVERSATION_ID,
  createSyntheticExport,
  messageIdFor,
  rawIndexFor,
} from "./fixtures/syntheticExport";

const COUNT = 1_000;
const initialState = useMessageStore.getState();
const store = () => useMessageStore.getState();

beforeEach(() => {
  useMessageStore.setState(initialState, true);
});

describe("deep-link navigation state", () => {
  it("keeps a link opened before the export is loaded and completes it on load", () => {
    const messageId = messageIdFor(10);
    store().requestNavigation({ conversationId: CONVERSATION_ID, messageId });
    expect(store().requestedDeepLink).toEqual({ conversationId: CONVERSATION_ID, messageId });
    expect(store().navigationTarget).toBeNull();

    store().setExportData(createSyntheticExport(COUNT).exportData);

    // Kept, so a replaced export can re-resolve it
    expect(store().requestedDeepLink).toEqual({ conversationId: CONVERSATION_ID, messageId });
    expect(store().selectedConversationId).toBe(CONVERSATION_ID);
    expect(store().navigationTarget).toMatchObject({
      conversationId: CONVERSATION_ID,
      messageId,
      rawIndex: rawIndexFor(10, COUNT),
      status: "pending",
    });
  });

  it("resolves a link immediately when the export is already loaded", () => {
    store().setExportData(createSyntheticExport(COUNT).exportData);
    store().selectConversation(GROUP_CONVERSATION_ID);

    store().requestNavigation({ conversationId: CONVERSATION_ID, messageId: messageIdFor(0) });

    expect(store().selectedConversationId).toBe(CONVERSATION_ID);
    expect(store().navigationTarget?.rawIndex).toBe(COUNT - 1);
    expect(store().navigationError).toBeNull();
  });

  it("opens a conversation without a message ID", () => {
    store().setExportData(createSyntheticExport(COUNT).exportData);
    store().requestNavigation({ conversationId: GROUP_CONVERSATION_ID, messageId: null });
    expect(store().selectedConversationId).toBe(GROUP_CONVERSATION_ID);
    expect(store().navigationTarget).toBeNull();
  });

  it("reports an unknown conversation without changing the selection", () => {
    store().setExportData(createSyntheticExport(COUNT).exportData);
    const before = store().selectedConversationId;

    store().requestNavigation({ conversationId: "8:live:unknown", messageId: "1" });

    expect(store().selectedConversationId).toBe(before);
    expect(store().navigationTarget).toBeNull();
    expect(store().navigationError?.kind).toBe("conversation-not-found");
    expect(store().navigationError?.message).toContain("8:live:unknown");
  });

  it("reports a conversation that has no messages", () => {
    store().setExportData(createSyntheticExport(COUNT).exportData);
    store().requestNavigation({ conversationId: "8:live:.cid.synthetic-empty", messageId: "1" });
    expect(store().navigationError?.kind).toBe("conversation-empty");
  });

  it("reports an unknown message instead of highlighting another one", () => {
    store().setExportData(createSyntheticExport(COUNT).exportData);
    store().requestNavigation({ conversationId: CONVERSATION_ID, messageId: "999" });

    expect(store().selectedConversationId).toBe(CONVERSATION_ID);
    expect(store().navigationTarget).toBeNull();
    expect(store().navigationError?.kind).toBe("message-not-found");
  });

  it("only completes the navigation request that is current", () => {
    store().setExportData(createSyntheticExport(COUNT).exportData);
    store().requestNavigation({ conversationId: CONVERSATION_ID, messageId: messageIdFor(1) });
    const first = store().navigationTarget!.requestId;
    store().requestNavigation({ conversationId: CONVERSATION_ID, messageId: messageIdFor(2) });
    const second = store().navigationTarget!.requestId;
    expect(second).toBeGreaterThan(first);

    store().completeNavigation(first);
    expect(store().navigationTarget?.status).toBe("pending");
    store().completeNavigation(second);
    expect(store().navigationTarget?.status).toBe("done");

    store().renavigate();
    expect(store().navigationTarget).toMatchObject({ status: "pending", messageId: messageIdFor(2) });
    expect(store().navigationTarget!.requestId).toBeGreaterThan(second);
  });

  it("drops the target when the user opens another conversation", () => {
    store().setExportData(createSyntheticExport(COUNT).exportData);
    store().requestNavigation({ conversationId: CONVERSATION_ID, messageId: messageIdFor(3) });
    store().selectConversation(CONVERSATION_ID);
    expect(store().navigationTarget).not.toBeNull();
    store().selectConversation(GROUP_CONVERSATION_ID);
    expect(store().navigationTarget).toBeNull();
  });
});

describe("replacing the export", () => {
  const link = { conversationId: CONVERSATION_ID, messageId: messageIdFor(800) };

  it("re-resolves the URL's link when the first export lacked the message", () => {
    store().requestNavigation(link);
    store().setExportData(createSyntheticExport(500).exportData); // older export
    expect(store().navigationError?.kind).toBe("message-not-found");
    expect(store().requestedDeepLink).toEqual(link);

    store().unloadExport();
    expect(store().exportData).toBeNull();
    expect(store().navigationError).toBeNull();
    expect(store().requestedDeepLink).toEqual(link);

    store().setExportData(createSyntheticExport(1_000).exportData);
    expect(store().navigationError).toBeNull();
    expect(store().navigationTarget).toMatchObject({
      messageId: messageIdFor(800),
      rawIndex: rawIndexFor(800, 1_000),
      status: "pending",
    });
  });

  it("re-resolves when an export is replaced without unloading first", () => {
    store().setExportData(createSyntheticExport(500).exportData);
    store().requestNavigation(link);
    expect(store().navigationError?.kind).toBe("message-not-found");

    store().setExportData(createSyntheticExport(1_000).exportData);
    expect(store().navigationTarget?.messageId).toBe(messageIdFor(800));
  });

  it("follows conversation clicks, which replace the link in the URL", () => {
    store().setExportData(createSyntheticExport(500).exportData);
    store().requestNavigation(link);
    // What useOpenConversation does for a sidebar click
    store().requestNavigation({ conversationId: GROUP_CONVERSATION_ID, messageId: null });
    expect(store().requestedDeepLink).toEqual({ conversationId: GROUP_CONVERSATION_ID, messageId: null });

    store().setExportData(createSyntheticExport(1_000).exportData);
    expect(store().selectedConversationId).toBe(GROUP_CONVERSATION_ID);
    expect(store().navigationTarget).toBeNull();
  });
});

describe("applyLocationToStore", () => {
  it("follows the URL as it changes (Back/Forward)", () => {
    store().setExportData(createSyntheticExport(COUNT).exportData);
    const params = (n: number) =>
      `conversationId=${encodeURIComponent(CONVERSATION_ID)}&messageId=${messageIdFor(n)}`;

    applyLocationToStore({ search: "", hash: `#${params(100)}` });
    expect(store().navigationTarget?.messageId).toBe(messageIdFor(100));

    applyLocationToStore({ search: "", hash: `#${params(200)}` });
    expect(store().navigationTarget?.messageId).toBe(messageIdFor(200));

    // Older query-form links still work
    applyLocationToStore({ search: `?${params(300)}`, hash: "" });
    expect(store().navigationTarget?.messageId).toBe(messageIdFor(300));

    applyLocationToStore({ search: "", hash: "" });
    expect(store().navigationTarget).toBeNull();
    expect(store().navigationError).toBeNull();
  });

  it("reports malformed links", () => {
    applyLocationToStore({ search: "", hash: "#messageId=1" });
    expect(store().navigationError?.kind).toBe("invalid-link");
    expect(store().requestedDeepLink).toBeNull();
  });
});
