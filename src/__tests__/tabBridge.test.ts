import { describe, expect, it, vi } from "vitest";
import { createTabBridge, type BridgeChannel } from "../utils/tabBridge";
import type { DeepLinkTarget } from "../utils/deepLink";
import type { Conversation } from "../types/messages";
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
