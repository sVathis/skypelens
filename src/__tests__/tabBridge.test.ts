import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTabBridge,
  OFFER_TTL_MS,
  type BridgeChannel,
  type ExportCopyState,
  type TabBridge,
} from "../utils/tabBridge";
import type { DeepLinkTarget } from "../utils/deepLink";
import type { ExportBroker } from "../utils/exportBroker";
import type { Conversation, SkypeExport } from "../types/messages";
import { canShowDeepLink } from "../utils/messageLocator";
import {
  CONVERSATION_ID,
  createSyntheticConversation,
  messageIdFor,
} from "./fixtures/syntheticExport";
import { createBrokerNetwork, createBus, flush } from "./fixtures/fakeChannels";

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

// --- Copying the export ---------------------------------------------------------------

const CONVERSATION_A = "8:live:synthetic-a";
const CONVERSATION_B = "8:live:synthetic-b";

function exportWith(conversationId: string): SkypeExport {
  return {
    userId: "8:live:owner",
    exportDate: "2024-12-31T00:00:00.000Z",
    conversations: [createSyntheticConversation(20, conversationId).conversation],
    mediaFiles: new Map([
      ["0-abc.1.jpg", new File(["synthetic"], "0-abc.1.jpg", { type: "image/jpeg" })],
    ]),
  };
}

const linkTo = (conversationId: string, n = 5): DeepLinkTarget => ({
  conversationId,
  messageId: messageIdFor(n),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

type Approve = (
  request: { code: string; target: DeepLinkTarget },
  signal: AbortSignal,
) => Promise<boolean>;

let tabCount = 0;

/** A SkypeLens tab with the copy feature: on the shared channel and the broker. */
function transferTab(
  bus: ReturnType<typeof createBus>,
  network: ReturnType<typeof createBrokerNetwork>,
  options: {
    exportData?: SkypeExport | null;
    wantsExport?: boolean;
    approve?: Approve;
    approvalTimeoutMs?: number;
    copyTimeoutMs?: number;
  } = {},
) {
  const tabId = `tab-${++tabCount}`;
  const broker: ExportBroker = network.connect(tabId);
  let exportData = options.exportData ?? null;
  const states: ExportCopyState[] = [];
  const handlers = {
    onNavigate: vi.fn(),
    onForwarded: vi.fn(),
    getExport: vi.fn(() => exportData),
    approve: vi.fn<Approve>(options.approve ?? (async () => true)),
    onExportReceived: vi.fn<(data: SkypeExport) => void>(),
  };
  const bridge: TabBridge = createTabBridge({
    channel: bus.open(),
    tabId,
    canHandle: (t) => exportData !== null && canShowDeepLink(exportData.conversations, t),
    onNavigate: handlers.onNavigate,
    onForwarded: handlers.onForwarded,
    exportTransfer: {
      broker,
      wantsExport: () => options.wantsExport ?? false,
      getExport: handlers.getExport,
      approve: handlers.approve,
      onCopyStateChange: (state) => states.push(state),
      onExportReceived: handlers.onExportReceived,
      approvalTimeoutMs: options.approvalTimeoutMs,
      copyTimeoutMs: options.copyTimeoutMs,
    },
  });
  return {
    tabId,
    bridge,
    broker,
    states,
    setExport: (data: SkypeExport | null) => (exportData = data),
    ...handlers,
  };
}

/** Records every message on the shared channel, as any same-origin context could. */
function spyOn(bus: ReturnType<typeof createBus>) {
  const channel: BridgeChannel = bus.open();
  const messages: Record<string, unknown>[] = [];
  channel.addEventListener("message", (event) => messages.push(event.data));
  return { channel, messages };
}

describe("copying the export to the report's tab", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the export only after the user allows it in the tab that holds it", async () => {
    const bus = createBus();
    const network = createBrokerNetwork();
    const answer = deferred<boolean>();
    const holder = transferTab(bus, network, {
      exportData: exportWith(CONVERSATION_A),
      approve: () => answer.promise,
    });
    const reportTab = transferTab(bus, network, { wantsExport: true });

    reportTab.bridge.offer(linkTo(CONVERSATION_A));
    await flush();

    const waiting = reportTab.states[reportTab.states.length - 1];
    expect(waiting).toEqual({
      phase: "awaiting-approval",
      code: expect.stringMatching(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/),
    });
    // The holder is asked with the same code the report's tab shows
    const code = waiting?.phase === "awaiting-approval" ? waiting.code : "";
    expect(holder.approve).toHaveBeenCalledWith(
      { code, target: linkTo(CONVERSATION_A) },
      expect.any(AbortSignal),
    );
    expect(reportTab.onExportReceived).not.toHaveBeenCalled();

    answer.resolve(true);
    await flush();

    expect(reportTab.states.slice(-2)).toEqual([{ phase: "copying" }, null]);
    expect(reportTab.onExportReceived).toHaveBeenCalledTimes(1);
    const [received] = reportTab.onExportReceived.mock.calls[0];
    expect(received).not.toBe(holder.getExport()); // A copy, not shared memory
    expect(received.conversations).toEqual(exportWith(CONVERSATION_A).conversations);
    // Browsers clone File objects (e2e/exportCopy.spec.ts checks their content); jsdom's
    // File doesn't survive Node's structuredClone, so only the media index is checked
    expect([...received.mediaFiles!.keys()]).toEqual(["0-abc.1.jpg"]);
    // The report's tab shows the link itself
    expect(holder.onNavigate).not.toHaveBeenCalled();
    expect(reportTab.onForwarded).not.toHaveBeenCalled();
  });

  it("sends nothing when the user doesn't allow it", async () => {
    const bus = createBus();
    const network = createBrokerNetwork();
    const holder = transferTab(bus, network, {
      exportData: exportWith(CONVERSATION_A),
      approve: async () => false,
    });
    const reportTab = transferTab(bus, network, { wantsExport: true });

    reportTab.bridge.offer(linkTo(CONVERSATION_A));
    await flush();

    expect(holder.approve).toHaveBeenCalledTimes(1);
    expect(reportTab.states[reportTab.states.length - 1]).toEqual({ phase: "failed", reason: "declined" });
    expect(reportTab.onExportReceived).not.toHaveBeenCalled();
  });

  it("still hands the link over from tabs that don't want a copy", async () => {
    const bus = createBus();
    const network = createBrokerNetwork();
    const holder = transferTab(bus, network, { exportData: exportWith(CONVERSATION_A) });
    const markdownTab = transferTab(bus, network, { wantsExport: false });

    markdownTab.bridge.offer(linkTo(CONVERSATION_A));
    await flush();

    expect(holder.onNavigate).toHaveBeenCalledWith(linkTo(CONVERSATION_A));
    expect(markdownTab.onForwarded).toHaveBeenCalledWith(linkTo(CONVERSATION_A));
    expect(holder.approve).not.toHaveBeenCalled();
  });

  describe("against another same-origin context", () => {
    it("never shows the export to a context listening on the shared channel or the hub", async () => {
      const bus = createBus();
      const network = createBrokerNetwork();
      const spy = spyOn(bus);
      const hubConnection = network.connectRaw();
      const hubMessages: unknown[] = [];
      hubConnection.addEventListener("message", (event) => hubMessages.push(event));
      hubConnection.start?.();
      hubConnection.postMessage({ type: "register", tabId: "eavesdropper" });
      transferTab(bus, network, { exportData: exportWith(CONVERSATION_A) });
      const reportTab = transferTab(bus, network, { wantsExport: true });

      reportTab.bridge.offer(linkTo(CONVERSATION_A));
      await flush();

      expect(reportTab.onExportReceived).toHaveBeenCalledTimes(1);
      expect(spy.messages.length).toBeGreaterThan(0);
      for (const message of spy.messages) {
        expect(Object.keys(message).sort()).not.toContain("data");
        expect(JSON.stringify(message)).not.toContain("Synthetic message");
      }
      // Hearing the offer's nonce gives no way in: nothing reaches other connections
      expect(hubMessages).toEqual([]);
    });

    it("asks the user about a request from a third tab, and sends nothing unless allowed", async () => {
      const bus = createBus();
      const network = createBrokerNetwork();
      const holder = transferTab(bus, network, {
        exportData: exportWith(CONVERSATION_A),
        approve: async () => false, // The user doesn't recognise the code
      });

      // The attacker learns the holder's tab ID by offering a link and reading the claim
      const spy = spyOn(bus);
      spy.channel.postMessage({ type: "navigate-offer", nonce: "probe", target: linkTo(CONVERSATION_A) });
      await flush();
      const claim = spy.messages.find((m) => m.type === "navigate-claim");
      expect(claim?.tabId).toBe(holder.tabId);

      const attacker = network.connect("attacker");
      const port = await attacker.requestExport(holder.tabId, {
        code: "AAA-AAA",
        target: linkTo(CONVERSATION_A),
      });
      const received: unknown[] = [];
      port!.addEventListener("message", (event) => received.push(event.data));
      port!.start?.();
      await flush();

      expect(holder.approve).toHaveBeenCalledWith(
        { code: "AAA-AAA", target: linkTo(CONVERSATION_A) },
        expect.any(AbortSignal),
      );
      expect(received).toEqual([{ type: "declined" }]);
    });

    it("asks one question at a time, so a third tab can't slip in a request", async () => {
      const bus = createBus();
      const network = createBrokerNetwork();
      const answer = deferred<boolean>();
      const holder = transferTab(bus, network, {
        exportData: exportWith(CONVERSATION_A),
        approve: () => answer.promise,
      });
      const reportTab = transferTab(bus, network, { wantsExport: true });
      reportTab.bridge.offer(linkTo(CONVERSATION_A));
      await flush();

      const attacker = network.connect("attacker");
      const port = await attacker.requestExport(holder.tabId, {
        code: "AAA-AAA",
        target: linkTo(CONVERSATION_A),
      });
      const received: unknown[] = [];
      port!.addEventListener("message", (event) => received.push(event.data));
      port!.start?.();
      await flush();

      expect(received).toEqual([{ type: "busy" }]);
      expect(holder.approve).toHaveBeenCalledTimes(1);
      answer.resolve(true);
      await flush();
      expect(reportTab.onExportReceived).toHaveBeenCalledTimes(1);
      expect(received).toEqual([{ type: "busy" }]);
    });

    it("doesn't let a third tab take over the holder's ID at the hub", async () => {
      const bus = createBus();
      const network = createBrokerNetwork();
      const holder = transferTab(bus, network, { exportData: exportWith(CONVERSATION_A) });
      const impostor = network.connectRaw();
      const impostorMessages: unknown[] = [];
      impostor.addEventListener("message", (event) => impostorMessages.push(event.data));
      impostor.start?.();
      impostor.postMessage({ type: "register", tabId: holder.tabId });
      await flush();
      expect(impostorMessages).toEqual([{ type: "register-rejected" }]);

      const reportTab = transferTab(bus, network, { wantsExport: true });
      reportTab.bridge.offer(linkTo(CONVERSATION_A));
      await flush();

      // Requests for the holder still reach the real holder
      expect(holder.approve).toHaveBeenCalledTimes(1);
      expect(reportTab.onExportReceived).toHaveBeenCalledTimes(1);
      expect(impostorMessages).toEqual([{ type: "register-rejected" }]);
    });

    it("ignores export requests and stray confirmations on the shared channel", async () => {
      const bus = createBus();
      const network = createBrokerNetwork();
      const holder = transferTab(bus, network, { exportData: exportWith(CONVERSATION_A) });
      const spy = spyOn(bus);

      // What the earlier version of this protocol accepted
      spy.channel.postMessage({ type: "export-request", nonce: "n1", tabId: holder.tabId });
      // A confirmation for an offer the holder never claimed
      spy.channel.postMessage({
        type: "navigate-confirm",
        nonce: "never-claimed",
        tabId: holder.tabId,
        target: linkTo(CONVERSATION_A),
      });
      await flush();

      expect(holder.approve).not.toHaveBeenCalled();
      expect(holder.onNavigate).not.toHaveBeenCalled();
    });
  });

  describe("links clicked while a copy is on its way", () => {
    it("replaces a pending copy when a newer link is held by another tab", async () => {
      const bus = createBus();
      const network = createBrokerNetwork();
      const answerA = deferred<boolean>();
      const answerB = deferred<boolean>();
      const holderA = transferTab(bus, network, {
        exportData: exportWith(CONVERSATION_A),
        approve: () => answerA.promise,
      });
      const holderB = transferTab(bus, network, {
        exportData: exportWith(CONVERSATION_B),
        approve: () => answerB.promise,
      });
      const reportTab = transferTab(bus, network, { wantsExport: true });

      // Two report links in quick succession, held by different tabs
      reportTab.bridge.offer(linkTo(CONVERSATION_A));
      await flush();
      reportTab.bridge.offer(linkTo(CONVERSATION_B));
      await flush();

      const [, signalA] = holderA.approve.mock.calls[0];
      expect(signalA.aborted).toBe(true); // Tab A's question is withdrawn
      expect(holderB.approve).toHaveBeenCalledTimes(1);

      answerB.resolve(true);
      await flush();
      // The older copy can't overwrite the newer one, even if A's user still allows it
      answerA.resolve(true);
      await flush();

      expect(reportTab.onExportReceived).toHaveBeenCalledTimes(1);
      const [received] = reportTab.onExportReceived.mock.calls[0];
      expect(received.conversations[0].id).toBe(CONVERSATION_B);
      expect(reportTab.states[reportTab.states.length - 1]).toBeNull();
    });

    it("keeps a pending copy when the newer link is in the same tab's export", async () => {
      const bus = createBus();
      const network = createBrokerNetwork();
      const answer = deferred<boolean>();
      const holder = transferTab(bus, network, {
        exportData: exportWith(CONVERSATION_A),
        approve: () => answer.promise,
      });
      const reportTab = transferTab(bus, network, { wantsExport: true });

      reportTab.bridge.offer(linkTo(CONVERSATION_A, 3));
      await flush();
      reportTab.bridge.offer(linkTo(CONVERSATION_A, 7));
      await flush();
      answer.resolve(true);
      await flush();

      expect(holder.approve).toHaveBeenCalledTimes(1);
      expect(reportTab.onExportReceived).toHaveBeenCalledTimes(1);
    });

    it("ignores an export that arrives for a replaced copy", async () => {
      const bus = createBus();
      const network = createBrokerNetwork();
      const spy = spyOn(bus);
      // A holder that would send its export even after being told to stop
      const staleHolder = network.connect("stale-holder");
      let stalePort: { postMessage: (message: unknown) => void } | null = null;
      staleHolder.onExportRequested(({ port }) => (stalePort = port));
      transferTab(bus, network, { exportData: exportWith(CONVERSATION_B) });
      const reportTab = transferTab(bus, network, { wantsExport: true });

      reportTab.bridge.offer(linkTo(CONVERSATION_A));
      await flush();
      const offer = spy.messages.find((m) => m.type === "navigate-offer");
      spy.channel.postMessage({ type: "navigate-claim", nonce: offer?.nonce, tabId: "stale-holder" });
      await flush();
      expect(stalePort).not.toBeNull();

      reportTab.bridge.offer(linkTo(CONVERSATION_B));
      await flush();
      stalePort!.postMessage({ type: "export", data: exportWith(CONVERSATION_A) });
      await flush();

      expect(reportTab.onExportReceived).toHaveBeenCalledTimes(1);
      expect(reportTab.onExportReceived.mock.calls[0][0].conversations[0].id).toBe(CONVERSATION_B);
    });
  });

  describe("failures", () => {
    it("reports an export that can't be cloned instead of staying in 'copying'", async () => {
      const bus = createBus();
      const network = createBrokerNetwork();
      const uncloneable = { ...exportWith(CONVERSATION_A), cannotClone: () => undefined };
      transferTab(bus, network, { exportData: uncloneable as SkypeExport });
      const reportTab = transferTab(bus, network, { wantsExport: true });

      reportTab.bridge.offer(linkTo(CONVERSATION_A));
      await flush();

      expect(reportTab.states.slice(1)).toEqual([
        { phase: "copying" },
        { phase: "failed", reason: "error" },
      ]);
      expect(reportTab.onExportReceived).not.toHaveBeenCalled();
      expect(reportTab.bridge.getPendingCounts().transfers).toBe(0);
    });

    it("gives up when nobody answers, and withdraws the question", async () => {
      vi.useFakeTimers();
      const bus = createBus();
      const network = createBrokerNetwork();
      const holder = transferTab(bus, network, {
        exportData: exportWith(CONVERSATION_A),
        approve: () => new Promise<boolean>(() => {}), // The user never answers
        approvalTimeoutMs: 60_000,
      });
      const reportTab = transferTab(bus, network, { wantsExport: true, approvalTimeoutMs: 30_000 });

      reportTab.bridge.offer(linkTo(CONVERSATION_A));
      await vi.advanceTimersByTimeAsync(0);
      expect(reportTab.states[reportTab.states.length - 1]?.phase).toBe("awaiting-approval");

      await vi.advanceTimersByTimeAsync(30_000);
      expect(reportTab.states[reportTab.states.length - 1]).toEqual({ phase: "failed", reason: "timeout" });
      // The report's tab told the holder it gave up
      const [, signal] = holder.approve.mock.calls[0];
      expect(signal.aborted).toBe(true);
      expect(holder.bridge.getPendingCounts().approvals).toBe(0);
    });

    it("reports a tab that is gone", async () => {
      const bus = createBus();
      const network = createBrokerNetwork();
      const holder = transferTab(bus, network, { exportData: exportWith(CONVERSATION_A) });
      const reportTab = transferTab(bus, network, { wantsExport: true });

      reportTab.bridge.offer(linkTo(CONVERSATION_A));
      holder.broker.close(); // Closed before the request reaches it
      await flush();

      expect(reportTab.states[reportTab.states.length - 1]).toEqual({ phase: "failed", reason: "unavailable" });
    });
  });

  describe("bookkeeping", () => {
    it("forgets an offer nobody claims, and ignores a late claim", async () => {
      vi.useFakeTimers();
      const bus = createBus();
      const network = createBrokerNetwork();
      const spy = spyOn(bus);
      const fresh = transferTab(bus, network);

      fresh.bridge.offer(linkTo(CONVERSATION_A));
      await vi.advanceTimersByTimeAsync(0);
      expect(fresh.bridge.getPendingCounts().offers).toBe(1);

      await vi.advanceTimersByTimeAsync(OFFER_TTL_MS);
      expect(fresh.bridge.getPendingCounts().offers).toBe(0);

      const offer = spy.messages.find((m) => m.type === "navigate-offer");
      spy.channel.postMessage({ type: "navigate-claim", nonce: offer?.nonce, tabId: "late" });
      await vi.advanceTimersByTimeAsync(0);
      expect(fresh.onForwarded).not.toHaveBeenCalled();
      expect(spy.messages.some((m) => m.type === "navigate-confirm")).toBe(false);
    });

    it("forgets a claim whose confirmation never comes, and ignores a late one", async () => {
      vi.useFakeTimers();
      const bus = createBus();
      const network = createBrokerNetwork();
      const spy = spyOn(bus);
      const holder = transferTab(bus, network, { exportData: exportWith(CONVERSATION_A) });

      // An offering tab that disappears after the claim (interrupted handshake)
      spy.channel.postMessage({ type: "navigate-offer", nonce: "n1", target: linkTo(CONVERSATION_A) });
      await vi.advanceTimersByTimeAsync(0);
      expect(holder.bridge.getPendingCounts().claims).toBe(1);

      await vi.advanceTimersByTimeAsync(OFFER_TTL_MS);
      expect(holder.bridge.getPendingCounts().claims).toBe(0);

      spy.channel.postMessage({
        type: "navigate-confirm",
        nonce: "n1",
        tabId: holder.tabId,
        target: linkTo(CONVERSATION_A),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(holder.onNavigate).not.toHaveBeenCalled();
    });

    it("stays bounded through many unsuccessful offers", async () => {
      vi.useFakeTimers();
      const bus = createBus();
      const network = createBrokerNetwork();
      const spy = spyOn(bus);
      const fresh = transferTab(bus, network);
      const holder = transferTab(bus, network, { exportData: exportWith(CONVERSATION_A) });

      for (let i = 0; i < 500; i++) {
        fresh.bridge.offer(linkTo(CONVERSATION_B)); // Nobody has it
        spy.channel.postMessage({ type: "navigate-offer", nonce: `n${i}`, target: linkTo(CONVERSATION_A) });
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(fresh.bridge.getPendingCounts().offers).toBe(1);
      expect(holder.bridge.getPendingCounts().claims).toBe(100);

      await vi.advanceTimersByTimeAsync(OFFER_TTL_MS);
      expect(fresh.bridge.getPendingCounts()).toEqual({ offers: 0, claims: 0, transfers: 0, approvals: 0 });
      expect(holder.bridge.getPendingCounts()).toEqual({ offers: 0, claims: 0, transfers: 0, approvals: 0 });
    });

    it("clears everything, timers included, when closed", async () => {
      vi.useFakeTimers();
      const bus = createBus();
      const network = createBrokerNetwork();
      const spy = spyOn(bus);
      const holder = transferTab(bus, network, {
        exportData: exportWith(CONVERSATION_A),
        approve: () => new Promise<boolean>(() => {}),
      });
      const reportTab = transferTab(bus, network, { wantsExport: true });

      reportTab.bridge.offer(linkTo(CONVERSATION_A)); // Transfer waiting for approval
      await vi.advanceTimersByTimeAsync(0);
      reportTab.bridge.offer(linkTo(CONVERSATION_B)); // Unclaimed offer
      spy.channel.postMessage({ type: "navigate-offer", nonce: "n1", target: linkTo(CONVERSATION_A) });
      await vi.advanceTimersByTimeAsync(0);
      expect(holder.bridge.getPendingCounts()).toMatchObject({ claims: 2, approvals: 1 });
      expect(reportTab.bridge.getPendingCounts()).toMatchObject({ offers: 1, transfers: 1 });

      for (const tab of [holder, reportTab]) {
        tab.bridge.close();
        tab.broker.close();
        expect(tab.bridge.getPendingCounts()).toEqual({ offers: 0, claims: 0, transfers: 0, approvals: 0 });
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
      const [, signal] = holder.approve.mock.calls[0];
      expect(signal.aborted).toBe(true);
    });
  });
});
