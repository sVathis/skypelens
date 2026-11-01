import { isDeepLinkTarget, type DeepLinkTarget } from "./deepLink";
import { randomId } from "./random";

/**
 * Connects two SkypeLens tabs privately, so one can send its export to the other.
 *
 * BroadcastChannel can't do this: every same-origin context that opens a channel name
 * receives everything posted on it. Instead, every tab connects to one SharedWorker
 * (the hub). When a tab asks another for its export, the hub creates a MessageChannel
 * and hands one end to each of the two tabs. Only those two tabs hold the ends, so no
 * other context can read what goes over it. The hub only passes the request along; it
 * never sees export data, and it routes the requester's end to the connection the
 * request came from, so a tab can't receive a channel by naming another tab.
 *
 * Whether the export is then sent is decided in the tab that holds it (tabBridge.ts).
 */

/** The parts of MessagePort used here, so tests can substitute in-memory ports. */
export interface PortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  start?(): void;
  close(): void;
}

export interface PortPair {
  port1: PortLike;
  port2: PortLike;
}

export interface ExportRequest {
  /** Shown in both tabs, so the user can tell which tab is asking. */
  code: string;
  /** The link the requesting tab wants to open. */
  target: DeepLinkTarget;
}

export interface ExportBroker {
  /**
   * Asks the tab with ID `holderTabId` for its export. Resolves to a private port to
   * that tab, or null if there is no such tab.
   */
  requestExport: (holderTabId: string, request: ExportRequest) => Promise<PortLike | null>;
  /** Called with a private port to each tab that asks this tab for its export. */
  onExportRequested: (handler: (request: ExportRequest & { port: PortLike }) => void) => void;
  close: () => void;
}

// How long to wait for the hub to set up a connection
const BROKER_RESPONSE_TIMEOUT_MS = 10_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** The hub that runs in the SharedWorker. */
export function createBrokerHub(createPortPair: () => PortPair = () => new MessageChannel()) {
  const tabs = new Map<string, PortLike>();

  return {
    connect(port: PortLike) {
      let ownId: string | null = null;

      port.addEventListener("message", (event) => {
        const message = asRecord(event.data);
        if (!message) return;

        if (message.type === "register") {
          if (ownId !== null || typeof message.tabId !== "string" || !message.tabId) return;
          // First come, first served: a tab registers its ID before it ever shares it,
          // so another context can't take it over
          if (tabs.has(message.tabId)) {
            port.postMessage({ type: "register-rejected" });
            return;
          }
          ownId = message.tabId;
          tabs.set(ownId, port);
          return;
        }

        if (message.type === "unregister") {
          if (ownId !== null && tabs.get(ownId) === port) tabs.delete(ownId);
          ownId = null;
          return;
        }

        if (message.type === "request-export" && typeof message.requestId === "string") {
          const { requestId, holderTabId, code, target } = message;
          const holder =
            ownId !== null && typeof holderTabId === "string" && holderTabId !== ownId
              ? tabs.get(holderTabId)
              : undefined;
          if (!holder || typeof code !== "string" || !isDeepLinkTarget(target)) {
            port.postMessage({ type: "export-unavailable", requestId });
            return;
          }
          const { port1, port2 } = createPortPair();
          holder.postMessage({ type: "export-requested", code, target }, [
            port2 as unknown as Transferable,
          ]);
          // Back to the connection the request came from, whatever ID it claims
          port.postMessage({ type: "export-channel", requestId }, [
            port1 as unknown as Transferable,
          ]);
        }
      });
      port.start?.();
    },
  };
}

/** A tab's connection to the hub. */
export function createExportBrokerClient(hub: PortLike, tabId: string): ExportBroker {
  const pending = new Map<
    string,
    { resolve: (port: PortLike | null) => void; timer: ReturnType<typeof setTimeout> }
  >();
  let requestHandler: ((request: ExportRequest & { port: PortLike }) => void) | null = null;

  const settle = (requestId: string, port: PortLike | null) => {
    const request = pending.get(requestId);
    if (!request) {
      port?.close();
      return;
    }
    pending.delete(requestId);
    clearTimeout(request.timer);
    request.resolve(port);
  };

  const handleMessage = (event: MessageEvent) => {
    const message = asRecord(event.data);
    const [port] = (event.ports ?? []) as readonly PortLike[];
    if (!message) return;

    if (message.type === "export-channel" && typeof message.requestId === "string") {
      settle(message.requestId, port ?? null);
    } else if (message.type === "export-unavailable" && typeof message.requestId === "string") {
      settle(message.requestId, null);
    } else if (
      message.type === "export-requested" &&
      port &&
      typeof message.code === "string" &&
      isDeepLinkTarget(message.target)
    ) {
      if (requestHandler) {
        requestHandler({ code: message.code, target: message.target, port });
      } else {
        port.close();
      }
    }
  };

  hub.addEventListener("message", handleMessage);
  hub.start?.();
  hub.postMessage({ type: "register", tabId });

  return {
    requestExport: (holderTabId, { code, target }) =>
      new Promise((resolve) => {
        const requestId = randomId();
        const timer = setTimeout(() => settle(requestId, null), BROKER_RESPONSE_TIMEOUT_MS);
        pending.set(requestId, { resolve, timer });
        hub.postMessage({ type: "request-export", requestId, holderTabId, code, target });
      }),
    onExportRequested: (handler) => {
      requestHandler = handler;
    },
    close: () => {
      for (const requestId of [...pending.keys()]) settle(requestId, null);
      requestHandler = null;
      hub.removeEventListener("message", handleMessage);
      // Not followed by hub.close(), which could drop the message; the connection
      // ends with the page
      hub.postMessage({ type: "unregister" });
    },
  };
}
