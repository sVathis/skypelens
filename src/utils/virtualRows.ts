import type { ProcessedMessage } from "../types/messages";
import { groupMessagesByDate, shouldGroupWithPrevious } from "./messageProcessor";

export interface VirtualRow {
  /** Stable key so virtualizer measurements survive older messages being prepended. */
  key: string;
  type: "date" | "message";
  content: string | ProcessedMessage;
  showSender: boolean;
  showTimestamp: boolean;
  messageIndex?: number;
}

export interface VirtualRowModel {
  rows: VirtualRow[];
  /** Displayed message ID -> row index (date separator rows included in the count). */
  rowIndexByMessageId: Map<string, number>;
}

/**
 * Builds the rows rendered by the virtualized message list.
 * `messages` are newest-first (as processed); rows are oldest-first with a date
 * separator row before each day.
 */
export function buildVirtualRows(messages: ProcessedMessage[]): VirtualRowModel {
  const rows: VirtualRow[] = [];
  const rowIndexByMessageId = new Map<string, number>();
  if (messages.length === 0) return { rows, rowIndexByMessageId };

  const reversedMessages = [...messages].reverse();
  const grouped = groupMessagesByDate(reversedMessages);
  const usedKeys = new Set<string>();
  let messageIndex = 0;

  const uniqueKey = (base: string) => {
    let key = base;
    for (let suffix = 1; usedKeys.has(key); suffix++) key = `${base}#${suffix}`;
    usedKeys.add(key);
    return key;
  };

  for (const [date, dateMessages] of grouped.entries()) {
    rows.push({
      key: uniqueKey(`date:${date}`),
      type: "date",
      content: date,
      showSender: false,
      showTimestamp: false,
    });

    for (let i = 0; i < dateMessages.length; i++) {
      const message = dateMessages[i];
      const previousMessage = i > 0 ? dateMessages[i - 1] : null;
      const nextMessage = i < dateMessages.length - 1 ? dateMessages[i + 1] : null;

      if (!rowIndexByMessageId.has(message.id)) {
        rowIndexByMessageId.set(message.id, rows.length);
      }
      rows.push({
        key: uniqueKey(`msg:${message.id}`),
        type: "message",
        content: message,
        showSender: !shouldGroupWithPrevious(message, previousMessage),
        showTimestamp: !nextMessage || !shouldGroupWithPrevious(nextMessage, message),
        messageIndex,
      });
      messageIndex++;
    }
  }

  return { rows, rowIndexByMessageId };
}
