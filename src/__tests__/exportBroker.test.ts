import { describe, expect, it } from "vitest";
import type { PortLike } from "../utils/exportBroker";
import { createBrokerNetwork, flush } from "./fixtures/fakeChannels";

const target = { conversationId: "8:live:a", messageId: "1" };

function record(port: PortLike) {
  const messages: unknown[] = [];
  port.addEventListener("message", (event) => messages.push(event.data));
  port.start?.();
  return messages;
}

describe("export broker hub", () => {
  it("connects only the requesting tab and the holder, privately", async () => {
    const network = createBrokerNetwork();
    const holder = network.connect("holder");
    const requester = network.connect("requester");
    const bystander = network.connectRaw();
    const bystanderMessages = record(bystander);
    bystander.postMessage({ type: "register", tabId: "bystander" });

    let holderPort: PortLike | null = null;
    holder.onExportRequested(({ code, port }) => {
      expect(code).toBe("ABC-DEF");
      holderPort = port;
    });
    const requesterPort = await requester.requestExport("holder", { code: "ABC-DEF", target });
    await flush();

    const received = record(holderPort!);
    requesterPort!.postMessage({ type: "hello" });
    await flush();
    expect(received).toEqual([{ type: "hello" }]);
    expect(bystanderMessages).toEqual([]);
  });

  it("rejects a second registration of a tab ID", async () => {
    const network = createBrokerNetwork();
    network.connect("holder");
    const impostor = network.connectRaw();
    const messages = record(impostor);
    impostor.postMessage({ type: "register", tabId: "holder" });
    await flush();
    expect(messages).toEqual([{ type: "register-rejected" }]);
  });

  it("reports unknown tabs, requests to itself and unregistered tabs as unavailable", async () => {
    const network = createBrokerNetwork();
    const requester = network.connect("requester");
    const leaving = network.connect("leaving");

    expect(await requester.requestExport("nobody", { code: "ABC-DEF", target })).toBeNull();
    expect(await requester.requestExport("requester", { code: "ABC-DEF", target })).toBeNull();
    leaving.close();
    expect(await requester.requestExport("leaving", { code: "ABC-DEF", target })).toBeNull();
  });

  it("ignores requests from a connection that never registered", async () => {
    const network = createBrokerNetwork();
    const holder = network.connect("holder");
    let asked = false;
    holder.onExportRequested(() => (asked = true));
    const anonymous = network.connectRaw();
    const messages = record(anonymous);
    anonymous.postMessage({ type: "request-export", requestId: "r1", holderTabId: "holder", code: "ABC-DEF", target });
    await flush();
    expect(asked).toBe(false);
    expect(messages).toEqual([{ type: "export-unavailable", requestId: "r1" }]);
  });
});
