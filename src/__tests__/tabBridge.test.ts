import { describe, expect, it, vi } from "vitest";
import { createTabBridge, type BridgeChannel } from "../utils/tabBridge";
import type { DeepLinkTarget } from "../utils/deepLink";
import type { Conversation, SkypeExport } from "../types/messages";
import { canShowDeepLink } from "../utils/messageLocator";
import {
  CONVERSATION_ID,
  createSyntheticConversation,
  messageIdFor,
} from "./fixtures/syntheticExport";

/** In-memory stand-in for BroadcastChannel: delivers to every other channel, asynchronously. */
function createBus() {
  const channels = new Set<FakeChannel>();
  class FakeChannel implements BridgeChannel {
    private listeners = new Set<(event: MessageEvent) => void>();
    constructor() {
      channels.add(this);
    }
    postMessage(message: unknown) {
      const data = structuredClone(message);
      for (const channel of channels) {
        if (channel === this) continue;
        queueMicrotask(() =>
          channel.listeners.forEach((listener) => listener({ data } as MessageEvent)),
        );
      }
    }
    addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
      this.listeners.add(listener);
    }
    removeEventListener(_type: "message", listener: (event: MessageEvent) => void) {
      this.listeners.delete(listener);
    }
    close() {
      channels.delete(this);
    }
  }
  return { open: () => new FakeChannel() };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const target: DeepLinkTarget = { conversationId: "8:live:a", messageId: "1700000000001" };

function tab(bus: ReturnType<typeof createBus>, conversations: string[]) {
  const onNavigate = vi.fn();
  const onForwarded = vi.fn();
  const channel = bus.open();
  const bridge = createTabBridge({
    channel,
    canHandle: (t) => conversations.includes(t.conversationId),
    onNavigate,
    onForwarded,
  });
  return { bridge, channel, onNavigate, onForwarded };
}

describe("tab bridge", () => {
  it("hands a link to exactly one tab that has the conversation loaded", async () => {
    const bus = createBus();
    const fresh = tab(bus, []);
    const unrelated = tab(bus, ["8:live:other"]);
    const loadedA = tab(bus, ["8:live:a"]);
    const loadedB = tab(bus, ["8:live:a"]);

    fresh.bridge.offer(target);
    await flush();

    expect(fresh.onForwarded).toHaveBeenCalledWith(target);
    expect(unrelated.onNavigate).not.toHaveBeenCalled();
    const navigations = loadedA.onNavigate.mock.calls.length + loadedB.onNavigate.mock.calls.length;
    expect(navigations).toBe(1);
    expect(fresh.onNavigate).not.toHaveBeenCalled();
  });

  it("skips a tab whose export has the conversation but not the message", async () => {
    const bus = createBus();
    const { conversation: older } = createSyntheticConversation(500);
    const { conversation: newer } = createSyntheticConversation(1_000);
    const link: DeepLinkTarget = { conversationId: CONVERSATION_ID, messageId: messageIdFor(800) };

    const makeTab = (conversations: Conversation[]) => {
      const onNavigate = vi.fn();
      createTabBridge({
        channel: bus.open(),
        canHandle: (t) => canShowDeepLink(conversations, t),
        onNavigate,
        onForwarded: vi.fn(),
      });
      return onNavigate;
    };
    // The older export is created first, so it would answer first if it claimed
    const olderNavigate = makeTab([older]);
    const newerNavigate = makeTab([newer]);
    const fresh = tab(bus, []);

    fresh.bridge.offer(link);
    await flush();
    expect(olderNavigate).not.toHaveBeenCalled();
    expect(newerNavigate).toHaveBeenCalledWith(link);
    expect(fresh.onForwarded).toHaveBeenCalledWith(link);
  });

  it("does nothing when no tab can show the link", async () => {
    const bus = createBus();
    const fresh = tab(bus, []);
    const other = tab(bus, ["8:live:other"]);
    fresh.bridge.offer(target);
    await flush();
    expect(fresh.onForwarded).not.toHaveBeenCalled();
    expect(other.onNavigate).not.toHaveBeenCalled();
  });

  it("only sends identifiers over the channel and ignores malformed messages", async () => {
    const bus = createBus();
    const spy = bus.open();
    const seen: unknown[] = [];
    spy.addEventListener("message", (event) => seen.push(event.data));
    const loaded = tab(bus, ["8:live:a"]);
    const fresh = tab(bus, []);

    spy.postMessage({ type: "navigate-confirm", nonce: "x", tabId: 42, target });
    spy.postMessage({ type: "navigate-offer", nonce: "y", target: { conversationId: 1 } });
    spy.postMessage("garbage");
    await flush();
    expect(loaded.onNavigate).not.toHaveBeenCalled();

    fresh.bridge.offer(target);
    await flush();
    for (const message of seen) {
      expect(Object.keys(message as object).sort()).toEqual(
        expect.arrayContaining(["nonce", "type"]),
      );
      const { target: sent } = message as { target?: DeepLinkTarget };
      if (sent) expect(Object.keys(sent).sort()).toEqual(["conversationId", "messageId"]);
    }
    expect(loaded.onNavigate).toHaveBeenCalledWith(target);
  });

  describe("copying the export", () => {
    const exportData: SkypeExport = {
      userId: "8:live:owner",
      exportDate: "2024-12-31T00:00:00.000Z",
      conversations: [createSyntheticConversation(20, "8:live:a").conversation],
      mediaFiles: new Map([["0-abc.1.jpg", new File(["synthetic"], "0-abc.1.jpg")]]),
    };

    /** Like BroadcastChannel: one bus per channel name. */
    function createTransferBuses() {
      const buses = new Map<string, ReturnType<typeof createBus>>();
      return {
        buses,
        open: (nonce: string) => {
          if (!buses.has(nonce)) buses.set(nonce, createBus());
          return buses.get(nonce)!.open();
        },
      };
    }

    function transferTab(
      bus: ReturnType<typeof createBus>,
      transfers: ReturnType<typeof createTransferBuses>,
      options: {
        loaded: boolean;
        wantsExport?: boolean;
        /** A tab running an older SkypeLens claims links but can't send its export. */
        canSendExport?: boolean;
        timeoutMs?: number;
      },
    ) {
      const { loaded, wantsExport = false, canSendExport = true, timeoutMs } = options;
      const handlers = {
        onNavigate: vi.fn(),
        onForwarded: vi.fn(),
        getExport: vi.fn(() => (loaded ? exportData : null)),
        onCopyStarted: vi.fn(),
        onExportReceived: vi.fn(),
        onCopyFailed: vi.fn(),
      };
      const bridge = createTabBridge({
        channel: bus.open(),
        canHandle: (t) => loaded && t.conversationId === target.conversationId,
        onNavigate: handlers.onNavigate,
        onForwarded: handlers.onForwarded,
        exportTransfer: canSendExport
          ? {
              openTransferChannel: transfers.open,
              wantsExport: () => wantsExport,
              getExport: handlers.getExport,
              onCopyStarted: handlers.onCopyStarted,
              onExportReceived: handlers.onExportReceived,
              onCopyFailed: handlers.onCopyFailed,
              timeoutMs,
            }
          : undefined,
      });
      return { bridge, ...handlers };
    }

    it("gives the report's tab a copy of the export instead of handing the link over", async () => {
      const bus = createBus();
      const transfers = createTransferBuses();
      const loaded = transferTab(bus, transfers, { loaded: true });
      const reportTab = transferTab(bus, transfers, { loaded: false, wantsExport: true });

      reportTab.bridge.offer(target);
      await flush();

      expect(reportTab.onCopyStarted).toHaveBeenCalledWith(target);
      expect(reportTab.onExportReceived).toHaveBeenCalledTimes(1);
      const [received] = reportTab.onExportReceived.mock.calls[0];
      // A copy, not shared memory
      expect(received).not.toBe(exportData);
      expect(received.conversations).toEqual(exportData.conversations);
      expect(received.userId).toBe(exportData.userId);
      // Browsers clone File objects; jsdom's File doesn't survive Node's structuredClone,
      // so only the media index is checked here
      expect([...received.mediaFiles.keys()]).toEqual(["0-abc.1.jpg"]);
      expect(reportTab.onCopyFailed).not.toHaveBeenCalled();
      // The report's tab shows the link itself
      expect(loaded.onNavigate).not.toHaveBeenCalled();
      expect(reportTab.onForwarded).not.toHaveBeenCalled();
    });

    it("sends the export only to the requesting tab, from one tab", async () => {
      const bus = createBus();
      const transfers = createTransferBuses();
      const mainChannel: unknown[] = [];
      bus.open().addEventListener("message", (event) => mainChannel.push(event.data));
      const loadedA = transferTab(bus, transfers, { loaded: true });
      const loadedB = transferTab(bus, transfers, { loaded: true });
      const otherFresh = transferTab(bus, transfers, { loaded: false });
      const reportTab = transferTab(bus, transfers, { loaded: false, wantsExport: true });

      reportTab.bridge.offer(target);
      await flush();

      expect(reportTab.onExportReceived).toHaveBeenCalledTimes(1);
      expect(loadedA.getExport.mock.calls.length + loadedB.getExport.mock.calls.length).toBe(1);
      expect(otherFresh.onExportReceived).not.toHaveBeenCalled();
      // The shared channel carries identifiers only; the export goes over its own channel
      expect(mainChannel.length).toBeGreaterThan(0);
      for (const message of mainChannel) expect(message).not.toHaveProperty("data");
      expect(transfers.buses.size).toBe(1);
    });

    it("still hands the link over from tabs that don't want a copy", async () => {
      const bus = createBus();
      const transfers = createTransferBuses();
      const loaded = transferTab(bus, transfers, { loaded: true });
      const markdownTab = transferTab(bus, transfers, { loaded: false, wantsExport: false });

      markdownTab.bridge.offer(target);
      await flush();

      expect(loaded.onNavigate).toHaveBeenCalledWith(target);
      expect(markdownTab.onForwarded).toHaveBeenCalledWith(target);
      expect(loaded.getExport).not.toHaveBeenCalled();
      expect(transfers.buses.size).toBe(0);
    });

    it("reports a failure when the other tab no longer has the export", async () => {
      const bus = createBus();
      const transfers = createTransferBuses();
      let unloaded = false;
      const loaded = transferTab(bus, transfers, { loaded: true });
      loaded.getExport.mockImplementation(() => (unloaded ? null : exportData));
      const reportTab = transferTab(bus, transfers, { loaded: false, wantsExport: true });

      unloaded = true;
      reportTab.bridge.offer(target);
      await flush();

      expect(reportTab.onCopyFailed).toHaveBeenCalledTimes(1);
      expect(reportTab.onExportReceived).not.toHaveBeenCalled();
    });

    it("gives up when no copy arrives", async () => {
      const bus = createBus();
      const transfers = createTransferBuses();
      transferTab(bus, transfers, { loaded: true, canSendExport: false });
      const reportTab = transferTab(bus, transfers, {
        loaded: false,
        wantsExport: true,
        timeoutMs: 5,
      });

      reportTab.bridge.offer(target);
      await flush();
      expect(reportTab.onCopyStarted).toHaveBeenCalled();
      expect(reportTab.onCopyFailed).not.toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(reportTab.onCopyFailed).toHaveBeenCalledTimes(1);
    });

    it("asks for one copy while another is on its way", async () => {
      const bus = createBus();
      const transfers = createTransferBuses();
      const loaded = transferTab(bus, transfers, { loaded: true });
      const reportTab = transferTab(bus, transfers, { loaded: false, wantsExport: true });

      reportTab.bridge.offer(target);
      reportTab.bridge.offer({ ...target, messageId: "1700000000002" });
      await flush();

      expect(loaded.getExport).toHaveBeenCalledTimes(1);
      expect(reportTab.onExportReceived).toHaveBeenCalledTimes(1);
    });
  });

  it("stops listening when closed", async () => {
    const bus = createBus();
    const fresh = tab(bus, []);
    const loaded = tab(bus, ["8:live:a"]);
    loaded.bridge.close();
    fresh.bridge.offer(target);
    await flush();
    expect(loaded.onNavigate).not.toHaveBeenCalled();
    expect(fresh.onForwarded).not.toHaveBeenCalled();
  });
});
