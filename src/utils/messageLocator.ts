import type { Message, ProcessedMessage } from "../types/messages";
import { DEEP_LINK_CONTEXT_MESSAGES } from "../constants/deepLink";

/**
 * Finds the position of an original Skype message in `Conversation.MessageList`.
 * Matching is exact on `Message.id`; returns -1 when the message is not in the conversation.
 */
export function findRawMessageIndex(messages: Message[], messageId: string): number {
  return messages.findIndex((message) => message.id === messageId);
}

/**
 * Number of raw messages that must be processed so the message at `rawIndex`
 * is included, plus some older messages for context above it.
 * MessageList is processed from index 0, so this is a prefix length.
 */
export function getRequiredMessageCount(
  rawIndex: number,
  totalMessages: number,
  context: number = DEEP_LINK_CONTEXT_MESSAGES,
): number {
  return Math.min(totalMessages, rawIndex + 1 + context);
}

const displayedIdCache = new WeakMap<ProcessedMessage[], Map<string, string>>();

/**
 * Maps every original message ID represented in the processed list to the ID of the
 * bubble that displays it. Merged messages (translation pairs) map to their bubble.
 */
export function getDisplayedIdMap(processed: ProcessedMessage[]): Map<string, string> {
  const cached = displayedIdCache.get(processed);
  if (cached) return cached;

  const map = new Map<string, string>();
  for (const message of processed) {
    if (!map.has(message.id)) map.set(message.id, message.id);
    for (const mergedId of message.mergedIds ?? []) {
      if (!map.has(mergedId)) map.set(mergedId, message.id);
    }
  }
  displayedIdCache.set(processed, map);
  return map;
}

export type DisplayedMessageResolution =
  /** The processed list does not cover the target yet. */
  | { status: "loading" }
  /** The target is displayed as its own bubble. */
  | { status: "exact"; displayId: string }
  /** The target was folded into another bubble (e.g. a translation pair). */
  | { status: "merged"; displayId: string }
  /**
   * The message processor does not display the target (e.g. album placeholders).
   * `displayId` is the nearest displayed message, or null if there is none.
   */
  | { status: "hidden"; displayId: string | null; messageType: string };

/**
 * Resolves which displayed bubble represents the original message at `rawIndex`.
 *
 * @param rawMessages - `Conversation.MessageList`
 * @param rawIndex - index of the requested message in `rawMessages`
 * @param processed - processed messages produced from the first `processedRawCount` raw messages
 * @param processedRawCount - how many raw messages `processed` covers
 */
export function resolveDisplayedMessage(
  rawMessages: Message[],
  rawIndex: number,
  processed: ProcessedMessage[],
  processedRawCount: number,
): DisplayedMessageResolution {
  const target = rawMessages[rawIndex];
  if (!target || processedRawCount <= rawIndex) {
    return { status: "loading" };
  }

  const displayedIds = getDisplayedIdMap(processed);
  const displayId = displayedIds.get(target.id);
  if (displayId !== undefined) {
    return displayId === target.id
      ? { status: "exact", displayId }
      : { status: "merged", displayId };
  }

  // Not displayed: fall back to the closest displayed neighbour, and say so.
  const limit = Math.min(processedRawCount, rawMessages.length);
  for (let distance = 1; distance < limit; distance++) {
    for (const index of [rawIndex - distance, rawIndex + distance]) {
      if (index < 0 || index >= limit) continue;
      const neighbourId = displayedIds.get(rawMessages[index].id);
      if (neighbourId !== undefined) {
        return { status: "hidden", displayId: neighbourId, messageType: target.messagetype };
      }
    }
  }

  return { status: "hidden", displayId: null, messageType: target.messagetype };
}
