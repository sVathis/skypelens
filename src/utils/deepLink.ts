import {
  CONVERSATION_ID_PARAM,
  MESSAGE_ID_PARAM,
  MAX_DEEP_LINK_ID_LENGTH,
} from "../constants/deepLink";

/**
 * A request to open a conversation, optionally at a specific message.
 * Both identifiers are the original IDs from the Skype export
 * (`Conversation.id` and `Message.id`), never display names or positions.
 */
export interface DeepLinkTarget {
  conversationId: string;
  messageId: string | null;
}

export type DeepLinkParseResult =
  | { kind: "none" }
  | { kind: "valid"; target: DeepLinkTarget }
  | { kind: "invalid"; reason: string };

/**
 * Parses deep-link parameters from a query string (e.g. `window.location.search`).
 * URLSearchParams performs the percent-decoding, so IDs containing `:`, `.`, `@`,
 * `+`, spaces or non-ASCII characters round-trip exactly.
 */
export function parseDeepLink(
  search: string | URLSearchParams,
): DeepLinkParseResult {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const conversationId = params.get(CONVERSATION_ID_PARAM);
  const messageId = params.get(MESSAGE_ID_PARAM);

  if (conversationId === null && messageId === null) {
    return { kind: "none" };
  }

  if (!conversationId) {
    return {
      kind: "invalid",
      reason: `The link is missing the "${CONVERSATION_ID_PARAM}" parameter.`,
    };
  }

  if (messageId === "") {
    return {
      kind: "invalid",
      reason: `The link has an empty "${MESSAGE_ID_PARAM}" parameter.`,
    };
  }

  if (
    conversationId.length > MAX_DEEP_LINK_ID_LENGTH ||
    (messageId?.length ?? 0) > MAX_DEEP_LINK_ID_LENGTH
  ) {
    return { kind: "invalid", reason: "The link contains an identifier that is too long." };
  }

  return { kind: "valid", target: { conversationId, messageId } };
}

export type DeepLinkLocation = Pick<Location, "search" | "hash">;

/**
 * Reads a deep link from a URL. The canonical form puts the parameters in the hash
 * (`#conversationId=…`); the older query form (`?conversationId=…`) is still accepted.
 * The hash wins when both are present.
 */
export function parseDeepLinkLocation(location: DeepLinkLocation): DeepLinkParseResult {
  const fromHash = parseDeepLink(location.hash.replace(/^#/, ""));
  return fromHash.kind === "none" ? parseDeepLink(location.search) : fromHash;
}

/**
 * Returns the URL the app is served from without deep-link parameters or hash, so
 * links work on any host, port or sub-path (e.g. GitHub Pages). Unrelated query
 * parameters are kept.
 */
export function getAppBaseUrl(href: string = window.location.href): string {
  const url = new URL(href);
  url.searchParams.delete(CONVERSATION_ID_PARAM);
  url.searchParams.delete(MESSAGE_ID_PARAM);
  url.hash = "";
  return url.toString();
}

/**
 * Builds the canonical deep-link URL for a conversation or message:
 * `<base>#conversationId=…&messageId=…`. Keeping the identifiers in the hash means
 * following a link in an open SkypeLens tab changes only the hash, so the browser
 * does not reload the page and the loaded export stays in memory.
 * Only identifiers are placed in the URL, never message content.
 */
export function buildDeepLinkUrl(
  target: DeepLinkTarget,
  baseUrl: string = getAppBaseUrl(),
): string {
  const url = new URL(getAppBaseUrl(baseUrl));
  const params = new URLSearchParams();
  params.set(CONVERSATION_ID_PARAM, target.conversationId);
  if (target.messageId !== null) {
    params.set(MESSAGE_ID_PARAM, target.messageId);
  }
  url.hash = params.toString();
  return url.toString();
}

export function isSameDeepLinkTarget(
  a: DeepLinkTarget | null,
  b: DeepLinkTarget | null,
): boolean {
  if (!a || !b) return a === b;
  return a.conversationId === b.conversationId && a.messageId === b.messageId;
}
