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

/**
 * Returns the URL the app is served from (origin + path) without query or hash,
 * so links work on any host, port or sub-path (e.g. GitHub Pages).
 */
export function getAppBaseUrl(href: string = window.location.href): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Builds the canonical deep-link URL for a conversation or message.
 * Only identifiers are placed in the URL, never message content.
 */
export function buildDeepLinkUrl(
  target: DeepLinkTarget,
  baseUrl: string = getAppBaseUrl(),
): string {
  const url = new URL(baseUrl);
  url.hash = "";
  url.searchParams.delete(CONVERSATION_ID_PARAM);
  url.searchParams.delete(MESSAGE_ID_PARAM);
  url.searchParams.set(CONVERSATION_ID_PARAM, target.conversationId);
  if (target.messageId !== null) {
    url.searchParams.set(MESSAGE_ID_PARAM, target.messageId);
  }
  return url.toString();
}

export function isSameDeepLinkTarget(
  a: DeepLinkTarget | null,
  b: DeepLinkTarget | null,
): boolean {
  if (!a || !b) return a === b;
  return a.conversationId === b.conversationId && a.messageId === b.messageId;
}
