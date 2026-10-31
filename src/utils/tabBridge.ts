import type { DeepLinkTarget } from "./deepLink";

/**
 * Forwards deep links between SkypeLens tabs of the same origin.
 *
 * A deep link opened in a fresh tab has no export loaded (nothing is persisted).
 * If another tab already has an export containing the conversation, the fresh tab
 * offers the link, the first tab that can show it claims it, and only that tab
 * navigates. Only the two identifiers travel over the channel: export data never
 * leaves the tab it was loaded into.
 */

type BridgeMessage =
  | { type: "navigate-offer"; nonce: string; target: DeepLinkTarget }
  | { type: "navigate-claim"; nonce: string; tabId: string }
  | { type: "navigate-confirm"; nonce: string; tabId: string; target: DeepLinkTarget };

export interface BridgeChannel {
  postMessage: (message: unknown) => void;
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  close: () => void;
}

export interface TabBridgeOptions {
  channel: BridgeChannel;
  tabId?: string;
  /** Whether this tab has an export loaded that contains the target conversation. */
  canHandle: (target: DeepLinkTarget) => boolean;
  /** Called in the tab chosen to show the link. */
  onNavigate: (target: DeepLinkTarget) => void;
  /** Called in the offering tab once another tab has taken the link. */
  onForwarded: (target: DeepLinkTarget) => void;
}

export interface TabBridge {
  offer: (target: DeepLinkTarget) => void;
  close: () => void;
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isTarget(value: unknown): value is DeepLinkTarget {
  if (!value || typeof value !== "object") return false;
  const { conversationId, messageId } = value as Record<string, unknown>;
  return (
    typeof conversationId === "string" &&
    conversationId.length > 0 &&
    (messageId === null || typeof messageId === "string")
  );
}

function parseMessage(data: unknown): BridgeMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (typeof message.nonce !== "string") return null;

  switch (message.type) {
    case "navigate-offer":
      return isTarget(message.target)
        ? { type: "navigate-offer", nonce: message.nonce, target: message.target }
        : null;
    case "navigate-claim":
      return typeof message.tabId === "string"
        ? { type: "navigate-claim", nonce: message.nonce, tabId: message.tabId }
        : null;
    case "navigate-confirm":
      return typeof message.tabId === "string" && isTarget(message.target)
        ? {
            type: "navigate-confirm",
            nonce: message.nonce,
            tabId: message.tabId,
            target: message.target,
          }
        : null;
    default:
      return null;
  }
}

export function createTabBridge({
  channel,
  tabId = randomId(),
  canHandle,
  onNavigate,
  onForwarded,
}: TabBridgeOptions): TabBridge {
  const openOffers = new Map<string, DeepLinkTarget>();

  const handleMessage = (event: MessageEvent) => {
    const message = parseMessage(event.data);
    if (!message) return;

    if (message.type === "navigate-offer") {
      if (canHandle(message.target)) {
        channel.postMessage({ type: "navigate-claim", nonce: message.nonce, tabId });
      }
      return;
    }

    if (message.type === "navigate-claim") {
      const target = openOffers.get(message.nonce);
      if (!target) return; // Not our offer, or another tab already claimed it
      openOffers.delete(message.nonce);
      channel.postMessage({
        type: "navigate-confirm",
        nonce: message.nonce,
        tabId: message.tabId,
        target,
      });
      onForwarded(target);
      return;
    }

    if (message.tabId === tabId) {
      onNavigate(message.target);
    }
  };

  channel.addEventListener("message", handleMessage);

  return {
    offer: (target) => {
      const nonce = randomId();
      openOffers.set(nonce, target);
      channel.postMessage({ type: "navigate-offer", nonce, target });
    },
    close: () => {
      openOffers.clear();
      channel.removeEventListener("message", handleMessage);
      channel.close();
    },
  };
}
