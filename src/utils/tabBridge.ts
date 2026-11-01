import type { DeepLinkTarget } from "./deepLink";
import type { SkypeExport } from "../types/messages";

/**
 * Passes deep links, and if needed the loaded export, between SkypeLens tabs of the
 * same origin.
 *
 * A deep link opened in a fresh tab has no export loaded (nothing is persisted).
 * The fresh tab offers the link, and the first tab whose export contains the message
 * claims it. Then either:
 *
 * - the claiming tab shows the link (only identifiers travel over the channel), or
 * - if the fresh tab wants a copy of the export (`exportTransfer.wantsExport`), the
 *   claiming tab sends it one and the fresh tab shows the link itself. The copy goes
 *   over a channel opened for that one transfer, so other SkypeLens tabs never
 *   receive it. It stays in this browser: tabs of the same origin only.
 */

type BridgeMessage =
  | { type: "navigate-offer"; nonce: string; target: DeepLinkTarget }
  | { type: "navigate-claim"; nonce: string; tabId: string }
  | { type: "navigate-confirm"; nonce: string; tabId: string; target: DeepLinkTarget }
  | { type: "export-request"; nonce: string; tabId: string };

type TransferMessage = { type: "export"; data: SkypeExport } | { type: "export-error" };

export interface BridgeChannel {
  postMessage: (message: unknown) => void;
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  close: () => void;
}

export interface ExportTransferOptions {
  /** Opens the channel that one export copy, identified by `nonce`, travels on. */
  openTransferChannel: (nonce: string) => BridgeChannel;
  /** Whether this tab takes a copy of the export instead of handing the link over. */
  wantsExport: () => boolean;
  /** The export this tab can copy to another tab. */
  getExport: () => SkypeExport | null;
  /** Called in the receiving tab: a copy is on its way. */
  onCopyStarted: (target: DeepLinkTarget) => void;
  onExportReceived: (data: SkypeExport) => void;
  onCopyFailed: () => void;
  /** How long to wait for the copy; cloning a large export takes a few seconds. */
  timeoutMs?: number;
}

export interface TabBridgeOptions {
  channel: BridgeChannel;
  tabId?: string;
  /** Whether this tab has an export loaded that contains the target message. */
  canHandle: (target: DeepLinkTarget) => boolean;
  /** Called in the tab chosen to show the link. */
  onNavigate: (target: DeepLinkTarget) => void;
  /** Called in the offering tab once another tab has taken the link. */
  onForwarded: (target: DeepLinkTarget) => void;
  exportTransfer?: ExportTransferOptions;
}

export interface TabBridge {
  offer: (target: DeepLinkTarget) => void;
  close: () => void;
}

const DEFAULT_TRANSFER_TIMEOUT_MS = 60_000;

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

function isExport(value: unknown): value is SkypeExport {
  if (!value || typeof value !== "object") return false;
  const { userId, conversations, mediaFiles } = value as Record<string, unknown>;
  return (
    typeof userId === "string" &&
    Array.isArray(conversations) &&
    (mediaFiles === undefined || mediaFiles instanceof Map)
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
    case "export-request":
      return typeof message.tabId === "string"
        ? { type: message.type, nonce: message.nonce, tabId: message.tabId }
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

function parseTransferMessage(data: unknown): TransferMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (message.type === "export" && isExport(message.data)) {
    return { type: "export", data: message.data };
  }
  return message.type === "export-error" ? { type: "export-error" } : null;
}

export function createTabBridge({
  channel,
  tabId = randomId(),
  canHandle,
  onNavigate,
  onForwarded,
  exportTransfer,
}: TabBridgeOptions): TabBridge {
  const openOffers = new Map<string, DeepLinkTarget>();
  // Offers this tab claimed, so it only sends its export for those
  const claimedOffers = new Set<string>();
  let pendingTransfer: { channel: BridgeChannel; timer: ReturnType<typeof setTimeout> } | null =
    null;

  const endTransfer = () => {
    if (!pendingTransfer) return;
    clearTimeout(pendingTransfer.timer);
    pendingTransfer.channel.close();
    pendingTransfer = null;
  };

  const requestExport = (
    transfer: ExportTransferOptions,
    nonce: string,
    from: string,
    target: DeepLinkTarget,
  ) => {
    const transferChannel = transfer.openTransferChannel(nonce);
    const fail = () => {
      endTransfer();
      transfer.onCopyFailed();
    };
    transferChannel.addEventListener("message", (event) => {
      const message = parseTransferMessage(event.data);
      if (!message) return;
      if (message.type === "export-error") {
        fail();
        return;
      }
      endTransfer();
      transfer.onExportReceived(message.data);
    });
    pendingTransfer = {
      channel: transferChannel,
      timer: setTimeout(fail, transfer.timeoutMs ?? DEFAULT_TRANSFER_TIMEOUT_MS),
    };
    // Listening on the transfer channel before asking, so the copy can't be missed
    channel.postMessage({ type: "export-request", nonce, tabId: from });
    transfer.onCopyStarted(target);
  };

  const sendExport = (transfer: ExportTransferOptions, nonce: string) => {
    const transferChannel = transfer.openTransferChannel(nonce);
    const data = transfer.getExport();
    try {
      transferChannel.postMessage(data ? { type: "export", data } : { type: "export-error" });
    } catch {
      // The export could not be cloned (e.g. out of memory)
      transferChannel.postMessage({ type: "export-error" });
    } finally {
      transferChannel.close();
    }
  };

  const handleMessage = (event: MessageEvent) => {
    const message = parseMessage(event.data);
    if (!message) return;

    if (message.type === "navigate-offer") {
      if (canHandle(message.target)) {
        claimedOffers.add(message.nonce);
        channel.postMessage({ type: "navigate-claim", nonce: message.nonce, tabId });
      }
      return;
    }

    if (message.type === "navigate-claim") {
      const target = openOffers.get(message.nonce);
      if (!target) return; // Not our offer, or another tab already claimed it
      openOffers.delete(message.nonce);

      if (exportTransfer?.wantsExport()) {
        // A copy already on its way will show the latest link once it arrives
        if (!pendingTransfer) requestExport(exportTransfer, message.nonce, message.tabId, target);
        return;
      }
      channel.postMessage({
        type: "navigate-confirm",
        nonce: message.nonce,
        tabId: message.tabId,
        target,
      });
      onForwarded(target);
      return;
    }

    // A confirmation or export request goes to the tab whose claim won
    const claimedHere = claimedOffers.delete(message.nonce);
    if (!claimedHere || message.tabId !== tabId) return;
    if (message.type === "export-request") {
      if (exportTransfer) sendExport(exportTransfer, message.nonce);
    } else {
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
      claimedOffers.clear();
      endTransfer();
      channel.removeEventListener("message", handleMessage);
      channel.close();
    },
  };
}
