import { isDeepLinkTarget, type DeepLinkTarget } from "./deepLink";
import type { ExportBroker, PortLike } from "./exportBroker";
import { randomCode, randomId } from "./random";
import type { SkypeExport } from "../types/messages";

/**
 * Passes deep links, and with the user's approval the loaded export, between
 * SkypeLens tabs of the same origin.
 *
 * A deep link opened in a fresh tab has no export loaded (nothing is persisted).
 * The fresh tab offers the link on a BroadcastChannel, and the first tab whose export
 * contains the message claims it. Only identifiers travel over that channel, which
 * every same-origin context can read. Then either:
 *
 * - the claiming tab shows the link, or
 * - if the fresh tab wants a copy of the export (`exportTransfer.wantsExport`), it asks
 *   the claiming tab for one over a private connection (exportBroker.ts). The claiming
 *   tab asks the user first, showing a code the asking tab also displays, and sends
 *   its export only if the user allows it. The fresh tab then shows the link itself.
 */

type BridgeMessage =
  | { type: "navigate-offer"; nonce: string; target: DeepLinkTarget }
  | { type: "navigate-claim"; nonce: string; tabId: string }
  | { type: "navigate-confirm"; nonce: string; tabId: string; target: DeepLinkTarget };

/**
 * Messages on the private connection, from the tab holding the export. All but
 * "approved" are its last message. The asking tab answers that with "received", or
 * sends "cancel" when it gives up; then both tabs close their ends.
 */
type TransferMessage =
  | { type: "approved" }
  | { type: "export"; data: SkypeExport }
  | { type: "declined" | "busy" | "export-error" };

export type ExportCopyFailure =
  | "declined"
  | "busy"
  | "error"
  | "timeout"
  | "unavailable"
  | "not-found";

/** Progress of copying an export from another SkypeLens tab into this one. */
export type ExportCopyState =
  | { phase: "awaiting-approval"; code: string }
  | { phase: "copying" }
  | { phase: "failed"; reason: ExportCopyFailure }
  | null;

export interface BridgeChannel {
  postMessage: (message: unknown) => void;
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  close: () => void;
}

export interface ExportTransferOptions {
  broker: ExportBroker;
  /** Whether this tab takes a copy of the export instead of handing the link over. */
  wantsExport: () => boolean;
  /** The export this tab can copy to another tab. */
  getExport: () => SkypeExport | null;
  /** Whether a received export can show the link. */
  exportHas: (data: SkypeExport, target: DeepLinkTarget) => boolean;
  /**
   * Asks the user whether to send this tab's export to the tab showing `code`.
   * `signal` aborts when the asking tab gives up; the answer is then ignored.
   */
  approve: (
    request: { code: string; target: DeepLinkTarget },
    signal: AbortSignal,
  ) => Promise<boolean>;
  /** Progress in the receiving tab. */
  onCopyStateChange: (state: ExportCopyState) => void;
  onExportReceived: (data: SkypeExport) => void;
  /** How long to wait for the user to answer in the other tab. */
  approvalTimeoutMs?: number;
  /** How long to wait for the copy once allowed; cloning a large export takes seconds. */
  copyTimeoutMs?: number;
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
  /** Sizes of the bridge's bookkeeping, for tests and diagnostics. */
  getPendingCounts: () => {
    offers: number;
    claims: number;
    transfers: number;
    approvals: number;
    ports: number;
  };
  close: () => void;
}

// Claims answer an offer within milliseconds; anything later is stale
export const OFFER_TTL_MS = 10_000;
const CLAIM_TTL_MS = 10_000;
// Claims this tab remembers at once, however many offers it sees
const MAX_CLAIMS = 100;
const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;
const DEFAULT_COPY_TIMEOUT_MS = 60_000;

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
      return isDeepLinkTarget(message.target)
        ? { type: "navigate-offer", nonce: message.nonce, target: message.target }
        : null;
    case "navigate-claim":
      return typeof message.tabId === "string"
        ? { type: "navigate-claim", nonce: message.nonce, tabId: message.tabId }
        : null;
    case "navigate-confirm":
      return typeof message.tabId === "string" && isDeepLinkTarget(message.target)
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
  switch (message.type) {
    case "export":
      return isExport(message.data) ? { type: "export", data: message.data } : null;
    case "approved":
    case "declined":
    case "busy":
    case "export-error":
      return { type: message.type };
    default:
      return null;
  }
}

/** A copy this tab asked another tab for. */
interface PendingTransfer {
  holderTabId: string;
  /** The newest link this tab asks for; the copy is only taken if it can show it. */
  target: DeepLinkTarget;
  /** The offer for `target`, while no tab has claimed it yet. */
  unclaimedNonce: string | null;
  port: PortLike | null;
  timer: ReturnType<typeof setTimeout>;
}

export function createTabBridge({
  channel,
  tabId = randomId(),
  canHandle,
  onNavigate,
  onForwarded,
  exportTransfer,
}: TabBridgeOptions): TabBridge {
  // Only the latest offer counts: it is the link this tab's URL asks for now
  let currentOffer: {
    nonce: string;
    target: DeepLinkTarget;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  // Offers this tab claimed, until the offering tab confirms or the claim expires
  const claims = new Map<string, ReturnType<typeof setTimeout>>();
  let transfer: PendingTransfer | null = null;
  // The request the user is being asked about in this tab, if any
  let approval: AbortController | null = null;
  // Ports to tabs that asked for this tab's export, with the function that closes each
  const holderPorts = new Map<PortLike, () => void>();
  let closed = false;

  const forgetClaim = (nonce: string) => {
    clearTimeout(claims.get(nonce));
    return claims.delete(nonce);
  };

  const rememberClaim = (nonce: string) => {
    if (claims.size >= MAX_CLAIMS) forgetClaim(claims.keys().next().value!);
    claims.set(nonce, setTimeout(() => claims.delete(nonce), CLAIM_TTL_MS));
  };

  const clearOffer = () => {
    if (currentOffer) clearTimeout(currentOffer.timer);
    currentOffer = null;
  };

  // --- Receiving a copy -------------------------------------------------------------

  /**
   * Ends a copy. `reply` tells the holder why: "received" after its last message,
   * "cancel" when this tab gives up. The port is closed right after: a short message
   * posted just before close() still arrives (checked in Chromium and Firefox), and the
   * holder closes its end when it gets it.
   */
  const endTransfer = (ended: PendingTransfer, reply: "received" | "cancel") => {
    clearTimeout(ended.timer);
    if (ended.port) {
      ended.port.postMessage({ type: reply });
      ended.port.close();
      ended.port = null;
    }
    if (transfer === ended) transfer = null;
  };

  const failTransfer = (
    failed: PendingTransfer,
    reason: ExportCopyFailure,
    reply: "received" | "cancel" = "cancel",
  ) => {
    if (transfer !== failed) return;
    endTransfer(failed, reply);
    exportTransfer?.onCopyStateChange({ phase: "failed", reason });
  };

  const startTransfer = (options: ExportTransferOptions, holderTabId: string, target: DeepLinkTarget) => {
    const code = randomCode();
    const started: PendingTransfer = {
      holderTabId,
      target,
      unclaimedNonce: null,
      port: null,
      timer: setTimeout(
        () => failTransfer(started, "timeout"),
        options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS,
      ),
    };
    transfer = started;
    options.onCopyStateChange({ phase: "awaiting-approval", code });

    void options.broker.requestExport(holderTabId, { code, target }).then((port) => {
      if (transfer !== started) {
        // Replaced by a newer link, or this tab closed, while connecting
        port?.postMessage({ type: "cancel" });
        port?.close();
        return;
      }
      if (!port) {
        failTransfer(started, "unavailable");
        return;
      }
      started.port = port;
      port.addEventListener("message", (event) => {
        // A transfer replaced by a newer one can't change this tab's state any more
        if (transfer !== started) return;
        const message = parseTransferMessage(event.data);
        if (!message) return;
        switch (message.type) {
          case "approved":
            clearTimeout(started.timer);
            started.timer = setTimeout(
              () => failTransfer(started, "timeout"),
              options.copyTimeoutMs ?? DEFAULT_COPY_TIMEOUT_MS,
            );
            options.onCopyStateChange({ phase: "copying" });
            return;
          case "export":
            // The newest link may have changed while the copy was on its way
            if (!options.exportHas(message.data, started.target)) {
              failTransfer(started, "not-found", "received");
              return;
            }
            endTransfer(started, "received");
            // The copy shows the newest link; a claim for it arriving now changes nothing
            clearOffer();
            options.onCopyStateChange(null);
            options.onExportReceived(message.data);
            return;
          case "declined":
          case "busy":
            failTransfer(started, message.type, "received");
            return;
          case "export-error":
            failTransfer(started, "error", "received");
            return;
        }
      });
      port.start?.();
    });
  };

  const handleClaimForExport = (
    options: ExportTransferOptions,
    holderTabId: string,
    target: DeepLinkTarget,
  ) => {
    // That tab is already asked for its export, and it has the newest link too
    if (transfer?.holderTabId === holderTabId) {
      transfer.unclaimedNonce = null;
      return;
    }
    // A newer link that another tab holds replaces the copy still on its way
    if (transfer) endTransfer(transfer, "cancel");
    startTransfer(options, holderTabId, target);
  };

  const expireOffer = (nonce: string) => {
    if (currentOffer?.nonce !== nonce) return;
    clearOffer();
    // No open tab has the newest link, so the copy on its way can't show it either
    if (transfer?.unclaimedNonce === nonce) failTransfer(transfer, "not-found");
  };

  // --- Sending a copy ---------------------------------------------------------------

  const handleExportRequest = (
    options: ExportTransferOptions,
    { code, target, port }: { code: string; target: DeepLinkTarget; port: PortLike },
  ) => {
    let onCancel = () => {};
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      clearTimeout(releaseTimer);
      port.removeEventListener("message", handleReply);
      holderPorts.delete(port);
      port.close();
    };
    const handleReply = (event: MessageEvent) => {
      const type = (event.data as { type?: unknown } | null)?.type;
      if (type === "cancel") onCancel();
      if (type === "cancel" || type === "received") release();
    };
    // Firefox can lose a large message posted just before close(), so after its last
    // message this tab keeps the port open until the asking tab answers or gives up
    const sendLast = (message: TransferMessage) => {
      try {
        port.postMessage(message);
      } catch {
        // The export could not be cloned (e.g. out of memory)
        port.postMessage({ type: "export-error" });
      }
      releaseTimer = setTimeout(release, options.copyTimeoutMs ?? DEFAULT_COPY_TIMEOUT_MS);
    };
    holderPorts.set(port, release);
    port.addEventListener("message", handleReply);
    port.start?.();

    if (!options.getExport() || !canHandle(target)) {
      sendLast({ type: "declined" });
      return;
    }
    if (approval) {
      // One question at a time; the asking tab can try again
      sendLast({ type: "busy" });
      return;
    }

    const controller = new AbortController();
    approval = controller;
    onCancel = () => controller.abort();
    // The asking tab gives up after the same time and stops listening
    const timer = setTimeout(() => {
      controller.abort();
      release();
    }, options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      if (approval === controller) approval = null;
    };
    // A withdrawn question is over at once, whether or not the UI answers it
    controller.signal.addEventListener("abort", finish);

    options
      .approve({ code, target }, controller.signal)
      .catch(() => false)
      .then((allowed) => {
        finish();
        // Cancelled, timed out or closed: the port is already released
        if (controller.signal.aborted || closed) return;
        if (!allowed) {
          sendLast({ type: "declined" });
          return;
        }
        port.postMessage({ type: "approved" });
        const data = options.getExport();
        sendLast(data ? { type: "export", data } : { type: "export-error" });
      });
  };

  // --- Links ------------------------------------------------------------------------

  const handleMessage = (event: MessageEvent) => {
    const message = parseMessage(event.data);
    if (!message) return;

    if (message.type === "navigate-offer") {
      if (canHandle(message.target)) {
        rememberClaim(message.nonce);
        channel.postMessage({ type: "navigate-claim", nonce: message.nonce, tabId });
      }
      return;
    }

    if (message.type === "navigate-claim") {
      // Not our offer, an older or expired one, or another tab already claimed it
      if (currentOffer?.nonce !== message.nonce) return;
      const { target } = currentOffer;
      clearOffer();

      if (exportTransfer?.wantsExport()) {
        handleClaimForExport(exportTransfer, message.tabId, target);
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

    // A confirmation goes to the tab whose claim won; others drop their claim
    const claimedHere = forgetClaim(message.nonce);
    if (claimedHere && message.tabId === tabId) onNavigate(message.target);
  };

  channel.addEventListener("message", handleMessage);
  exportTransfer?.broker.onExportRequested((request) =>
    handleExportRequest(exportTransfer, request),
  );

  return {
    offer: (target) => {
      clearOffer();
      const nonce = randomId();
      currentOffer = { nonce, target, timer: setTimeout(() => expireOffer(nonce), OFFER_TTL_MS) };
      // A copy on its way now has to show this link: it is kept if the same tab claims
      // it, replaced if another tab does, and dropped if no tab does
      if (transfer) {
        transfer.target = target;
        transfer.unclaimedNonce = nonce;
      }
      channel.postMessage({ type: "navigate-offer", nonce, target });
    },
    getPendingCounts: () => ({
      offers: currentOffer ? 1 : 0,
      claims: claims.size,
      transfers: transfer ? 1 : 0,
      approvals: approval ? 1 : 0,
      ports: holderPorts.size + (transfer?.port ? 1 : 0),
    }),
    close: () => {
      closed = true;
      clearOffer();
      for (const nonce of [...claims.keys()]) forgetClaim(nonce);
      if (transfer) endTransfer(transfer, "cancel");
      approval?.abort();
      for (const release of [...holderPorts.values()]) release();
      channel.removeEventListener("message", handleMessage);
      channel.close();
    },
  };
}
