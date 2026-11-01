import type { BridgeChannel } from "../../utils/tabBridge";
import {
  createBrokerHub,
  createExportBrokerClient,
  type PortLike,
  type PortPair,
} from "../../utils/exportBroker";

type Listener = (event: MessageEvent) => void;

/**
 * In-memory stand-in for one BroadcastChannel name: delivers to every other channel
 * object on the bus, asynchronously, as a structured clone.
 */
export function createBus() {
  const channels = new Set<FakeChannel>();
  class FakeChannel implements BridgeChannel {
    private listeners = new Set<Listener>();
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
    addEventListener(_type: "message", listener: Listener) {
      this.listeners.add(listener);
    }
    removeEventListener(_type: "message", listener: Listener) {
      this.listeners.delete(listener);
    }
    close() {
      channels.delete(this);
    }
  }
  return { open: (): BridgeChannel => new FakeChannel() };
}

export interface FakePortPair extends PortPair {
  port1: PortLike & { closed: boolean };
  port2: PortLike & { closed: boolean };
}

/**
 * In-memory stand-in for MessageChannel. Like a real port, postMessage clones the
 * message (throwing DataCloneError for what can't be cloned) and delivers it only to
 * the other end, with transferred ports in `event.ports`. Each end closes on its own;
 * nothing reaches a closed end. A short message posted just before close() still
 * arrives, but an export still on its way is lost, as Firefox loses a large message.
 */
export function createPortPair(): FakePortPair {
  class FakePort implements PortLike {
    other!: FakePort;
    closed = false;
    private listeners = new Set<Listener>();
    // Like a real port used with addEventListener, messages wait until start()
    private started = false;
    private queue: MessageEvent[] = [];
    postMessage(message: unknown, transfer: Transferable[] = []) {
      if (this.closed) return;
      const data = structuredClone(message);
      const target = this.other;
      const isExport = (data as { type?: unknown } | null)?.type === "export";
      queueMicrotask(() => {
        if (isExport && this.closed) return;
        target.receive({ data, ports: transfer } as unknown as MessageEvent);
      });
    }
    private receive(event: MessageEvent) {
      if (this.closed) return;
      if (!this.started) {
        this.queue.push(event);
        return;
      }
      this.listeners.forEach((listener) => listener(event));
    }
    addEventListener(_type: "message", listener: Listener) {
      this.listeners.add(listener);
    }
    removeEventListener(_type: "message", listener: Listener) {
      this.listeners.delete(listener);
    }
    start() {
      if (this.started) return;
      this.started = true;
      const queued = this.queue.splice(0);
      queueMicrotask(() => queued.forEach((event) => this.receive(event)));
    }
    close() {
      this.closed = true;
    }
  }
  const port1 = new FakePort();
  const port2 = new FakePort();
  port1.other = port2;
  port2.other = port1;
  return { port1, port2 };
}

/** One SharedWorker hub, with every tab of the test connected to it. */
export function createBrokerNetwork() {
  // The private connections the hub set up between tabs
  const transferPorts: FakePortPair[] = [];
  const hub = createBrokerHub(() => {
    const pair = createPortPair();
    transferPorts.push(pair);
    return pair;
  });
  return {
    transferPorts,
    /** Ends of private connections that are still open. */
    openTransferPorts: () =>
      transferPorts.flatMap(({ port1, port2 }) => [port1, port2]).filter((port) => !port.closed),
    /** The raw connection a tab (or an attacker) has to the hub. */
    connectRaw: (): PortLike => {
      const { port1, port2 } = createPortPair();
      hub.connect(port2);
      return port1;
    },
    connect(tabId: string) {
      return createExportBrokerClient(this.connectRaw(), tabId);
    },
  };
}

/** Lets queued microtasks and zero-delay timers run. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
