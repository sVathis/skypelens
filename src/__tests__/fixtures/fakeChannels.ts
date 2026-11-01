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

/**
 * In-memory stand-in for MessageChannel. Like a real port, postMessage clones the
 * message (throwing DataCloneError for what can't be cloned) and delivers it only to
 * the other end, with transferred ports in `event.ports`.
 */
export function createPortPair(): PortPair {
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
      queueMicrotask(() => target.receive({ data, ports: transfer } as unknown as MessageEvent));
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
      this.other.closed = true;
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
  const hub = createBrokerHub(createPortPair);
  return {
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
