import { describe, expect, it } from "vitest";
import {
  buildDeepLinkUrl,
  getAppBaseUrl,
  parseDeepLink,
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
    const parsed = parseDeepLink(new URL(url).search);
    expect(parsed).toEqual({ kind: "valid", target });
  });

  it("percent-encodes identifiers and never needs message content", () => {
    const url = buildDeepLinkUrl(
      { conversationId: "8:live:.cid.abc", messageId: "1700000000001" },
      "http://localhost:5173/",
    );
    expect(url).toBe(
      "http://localhost:5173/?conversationId=8%3Alive%3A.cid.abc&messageId=1700000000001",
    );
  });

  it("keeps host, port and sub-path of the base URL and drops the fragment", () => {
    const url = buildDeepLinkUrl(
      { conversationId: "a:b", messageId: "c.d" },
      "https://example.github.io:8443/skypelens/?theme=dark#stale",
    );
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://example.github.io:8443");
    expect(parsed.pathname).toBe("/skypelens/");
    expect(parsed.hash).toBe("");
    expect(parsed.searchParams.get("theme")).toBe("dark");
  });

  it("replaces existing link parameters instead of duplicating them", () => {
    const url = buildDeepLinkUrl(
      { conversationId: "new", messageId: null },
      "http://localhost:5173/?conversationId=old&messageId=1",
    );
    expect(url).toBe("http://localhost:5173/?conversationId=new");
  });

  it("derives the base URL from the current location", () => {
    expect(getAppBaseUrl("http://127.0.0.1:4173/sub/path/?conversationId=x#y")).toBe(
      "http://127.0.0.1:4173/sub/path/",
    );
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
      const parsed = parseDeepLink(new URL(testCase.url).search);
      expect(parsed).toEqual({
        kind: "valid",
        target: {
          conversationId: testCase.conversation_id,
          messageId: testCase.message_id,
        },
      });
      // And SkypeLens builds an equivalent link for the same base URL
      const rebuilt = new URL(
        buildDeepLinkUrl(parsed.kind === "valid" ? parsed.target : TRICKY_IDS[0], testCase.base_url),
      );
      expect(Object.fromEntries(rebuilt.searchParams)).toEqual(
        Object.fromEntries(new URL(testCase.url).searchParams),
      );
    }
  });
});
