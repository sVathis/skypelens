import { describe, expect, it } from "vitest";
import {
  buildDeepLinkUrl,
  getAppBaseUrl,
  parseDeepLink,
  parseDeepLinkLocation,
  type DeepLinkTarget,
} from "../utils/deepLink";
import contract from "../../tools/deep_link_contract.json";

const TRICKY_IDS: DeepLinkTarget[] = [
  { conversationId: "8:live:.cid.0123456789abcdef", messageId: "1700000000001" },
  { conversationId: "19:synthetic.thread_01@thread.skype", messageId: "msg.with.periods:and:colons" },
  { conversationId: "28:concierge", messageId: "id&with=reserved#chars?%/" },
  { conversationId: "8:live:jane+doe smith", messageId: "+plus +space " },
  { conversationId: "8:live:ελληνικά", messageId: "📎-42" },
  { conversationId: "48:notes", messageId: null },
];

describe("deep link URLs", () => {
  it.each(TRICKY_IDS)("round-trips %o", (target) => {
    const url = buildDeepLinkUrl(target, "http://localhost:5173/");
    const parsed = parseDeepLinkLocation(new URL(url));
    expect(parsed).toEqual({ kind: "valid", target });
    expect(new URL(url).search).toBe("");
  });

  it("percent-encodes identifiers and never needs message content", () => {
    const url = buildDeepLinkUrl(
      { conversationId: "8:live:.cid.abc", messageId: "1700000000001" },
      "http://localhost:5173/",
    );
    expect(url).toBe(
      "http://localhost:5173/#conversationId=8%3Alive%3A.cid.abc&messageId=1700000000001",
    );
  });

  it("keeps host, port, sub-path and unrelated query of the base URL, replacing the hash", () => {
    const url = buildDeepLinkUrl(
      { conversationId: "a:b", messageId: "c.d" },
      "https://example.github.io:8443/skypelens/?theme=dark#stale",
    );
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://example.github.io:8443");
    expect(parsed.pathname).toBe("/skypelens/");
    expect(parsed.hash).toBe("#conversationId=a%3Ab&messageId=c.d");
    expect(parsed.search).toBe("?theme=dark");
  });

  it("moves link parameters out of the query of an older-style base URL", () => {
    const url = buildDeepLinkUrl(
      { conversationId: "new", messageId: null },
      "http://localhost:5173/?conversationId=old&messageId=1#conversationId=older",
    );
    expect(url).toBe("http://localhost:5173/#conversationId=new");
  });

  it("reads links from the hash and still accepts the older query form", () => {
    const target = { conversationId: "8:live:a", messageId: "1" };
    expect(parseDeepLinkLocation({ search: "", hash: "#conversationId=8%3Alive%3Aa&messageId=1" }))
      .toEqual({ kind: "valid", target });
    expect(parseDeepLinkLocation({ search: "?conversationId=8%3Alive%3Aa&messageId=1", hash: "" }))
      .toEqual({ kind: "valid", target });
    // The hash wins: it is what changes when a link is followed in an open tab
    expect(
      parseDeepLinkLocation({ search: "?conversationId=old&messageId=0", hash: "#conversationId=8%3Alive%3Aa&messageId=1" }),
    ).toEqual({ kind: "valid", target });
    expect(parseDeepLinkLocation({ search: "?theme=dark", hash: "#section" })).toEqual({ kind: "none" });
  });

  it("derives the base URL from the current location", () => {
    expect(getAppBaseUrl("http://127.0.0.1:4173/sub/path/?conversationId=x#y")).toBe(
      "http://127.0.0.1:4173/sub/path/",
    );
  });

  it("keeps unrelated query parameters byte for byte", () => {
    // Re-serializing would turn %20 into "+" and the URL would no longer match the
    // report link before the "#", so following it would reload the tab
    expect(getAppBaseUrl("http://h/?note=a%20b&q=a+b&x=%2B&conversationId=old&&empty=#y")).toBe(
      "http://h/?note=a%20b&q=a+b&x=%2B&empty=",
    );
    expect(getAppBaseUrl("http://h/?conversationId=old")).toBe("http://h/");
  });

  it("treats a URL without link parameters as no link", () => {
    expect(parseDeepLink("")).toEqual({ kind: "none" });
    expect(parseDeepLink("?theme=dark")).toEqual({ kind: "none" });
  });

  it.each([
    ["?messageId=123", "missing"],
    ["?conversationId=&messageId=123", "missing"],
    ["?conversationId=8%3Alive%3Aa&messageId=", "empty"],
    [`?conversationId=${"x".repeat(2000)}`, "too long"],
  ])("rejects malformed link %s", (search, reason) => {
    const parsed = parseDeepLink(search);
    expect(parsed.kind).toBe("invalid");
    expect(parsed.kind === "invalid" && parsed.reason).toContain(reason);
  });

  it("parses every URL in the shared Python contract", () => {
    for (const testCase of contract.cases) {
      const parsed = parseDeepLinkLocation(new URL(testCase.url));
      expect(parsed).toEqual({
        kind: "valid",
        target: {
          conversationId: testCase.conversation_id,
          messageId: testCase.message_id,
        },
      });
      // SkypeLens builds an equivalent link for the same base URL. Everything before the
      // "#" must match exactly, or following a report link would reload an open tab.
      const rebuilt = buildDeepLinkUrl(
        parsed.kind === "valid" ? parsed.target : TRICKY_IDS[0],
        testCase.base_url,
      );
      expect(rebuilt.split("#")[0]).toBe(testCase.url.split("#")[0]);
      expect(parseDeepLinkLocation(new URL(rebuilt))).toEqual(parsed);
    }
  });
});
