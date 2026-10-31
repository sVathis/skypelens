import type { Conversation, Message, SkypeExport } from "../../types/messages";

export const OWNER_ID = "8:live:.cid.synthetic-owner";
export const OTHER_ID = "8:live:.cid.synthetic-other";
export const CONVERSATION_ID = "8:live:.cid.synthetic-other";
export const GROUP_CONVERSATION_ID = "19:synthetic.group_01@thread.skype";

/** Message ID of the n-th message in chronological order (0 = oldest). */
export const messageIdFor = (n: number) => `${1600000000000 + n * 1000}`;

export interface SpecialMessages {
  /** Owner Translation metadata (merged into the following RichText bubble). */
  ownerTranslationId: string;
  ownerTranslationOriginalId: string;
  /** Other participant's Translation (displayed) and its hidden original. */
  otherTranslationId: string;
  otherTranslationOriginalId: string;
  /** A RichText/Media_Album placeholder, which SkypeLens never displays. */
  albumId: string;
}

/**
 * Builds a synthetic conversation with `count` messages, newest first like a real
 * Skype export, spread over several years with a few messages per day.
 * Chronological message n (0 = oldest) has ID `messageIdFor(n)` and sits at raw index
 * `count - 1 - n`. Contains no real conversation content.
 */
export function createSyntheticConversation(
  count: number,
  id: string = CONVERSATION_ID,
): { conversation: Conversation; special: SpecialMessages } {
  const start = Date.UTC(2021, 0, 1, 8, 0, 0);
  const messages: Message[] = [];

  for (let n = 0; n < count; n++) {
    const from = n % 3 === 0 ? OWNER_ID : OTHER_ID;
    messages.push({
      id: messageIdFor(n),
      displayName: from === OWNER_ID ? "Synthetic Owner" : "Synthetic Other",
      originalarrivaltime: new Date(start + n * 3 * 3600 * 1000).toISOString(),
      messagetype: n % 10 === 0 ? "RichText" : "Text",
      version: 1,
      content: `Synthetic message number ${n}`,
      conversationid: id,
      from,
    });
  }

  // Special processing cases in the middle of the conversation (chronological positions)
  const setType = (n: number, patch: Partial<Message>) => {
    messages[n] = { ...messages[n], ...patch };
  };
  const translation = (text: string) =>
    JSON.stringify({ translations: [{ translation: text, loc: "en" }], oloc: "xx", oid: "0" });

  const base = Math.floor(count / 2);
  // Raw order is newest first, so the "next" raw message of a Translation is the
  // chronologically previous one.
  setType(base + 1, { messagetype: "Translation", from: OWNER_ID, content: translation("owner translated") });
  setType(base, { messagetype: "RichText", from: OWNER_ID, content: "Synthetic owner original" });
  setType(base + 4, { messagetype: "Translation", from: OTHER_ID, content: translation("other translated") });
  setType(base + 3, { messagetype: "RichText", from: OTHER_ID, content: "Synthetic other original" });
  setType(base + 8, { messagetype: "RichText/Media_Album", from: OTHER_ID, content: "<album/>" });

  messages.reverse();

  return {
    conversation: {
      id,
      displayName: "Synthetic Other",
      version: 1,
      properties: {
        conversationblocked: false,
        lastimreceivedtime: null,
        consumptionhorizon: null,
        conversationstatus: null,
      },
      threadProperties: null,
      MessageList: messages,
    },
    special: {
      ownerTranslationId: messageIdFor(base + 1),
      ownerTranslationOriginalId: messageIdFor(base),
      otherTranslationId: messageIdFor(base + 4),
      otherTranslationOriginalId: messageIdFor(base + 3),
      albumId: messageIdFor(base + 8),
    },
  };
}

export function createSyntheticExport(count = 10_000): {
  exportData: SkypeExport;
  conversation: Conversation;
  special: SpecialMessages;
} {
  const { conversation, special } = createSyntheticConversation(count);
  const { conversation: group } = createSyntheticConversation(120, GROUP_CONVERSATION_ID);
  const empty: Conversation = { ...group, id: "8:live:.cid.synthetic-empty", MessageList: [] };

  return {
    exportData: {
      userId: OWNER_ID,
      exportDate: "2024-12-31T00:00:00.000Z",
      conversations: [group, conversation, empty],
    },
    conversation,
    special,
  };
}

/** Raw index of the chronological message n in a conversation of `count` messages. */
export const rawIndexFor = (n: number, count: number) => count - 1 - n;
