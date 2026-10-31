import { describe, expect, it } from "vitest";
import { processMessages } from "../utils/messageProcessor";
import {
  findRawMessageIndex,
  getRequiredMessageCount,
  resolveDisplayedMessage,
} from "../utils/messageLocator";
import { buildVirtualRows } from "../utils/virtualRows";
import {
  OWNER_ID,
  createSyntheticConversation,
  messageIdFor,
  rawIndexFor,
} from "./fixtures/syntheticExport";

const COUNT = 400;
const { conversation, special } = createSyntheticConversation(COUNT);
const raw = conversation.MessageList;

function resolve(messageId: string, swapped = false, rawCount = raw.length) {
  const processed = processMessages(raw, OWNER_ID, swapped, undefined, rawCount);
  return resolveDisplayedMessage(raw, findRawMessageIndex(raw, messageId), processed, rawCount);
}

describe("findRawMessageIndex / getRequiredMessageCount", () => {
  it("finds messages by exact original ID", () => {
    expect(findRawMessageIndex(raw, messageIdFor(0))).toBe(COUNT - 1);
    expect(findRawMessageIndex(raw, messageIdFor(COUNT - 1))).toBe(0);
    expect(findRawMessageIndex(raw, "does-not-exist")).toBe(-1);
    // No prefix or partial matching
    expect(findRawMessageIndex(raw, messageIdFor(1).slice(0, -1))).toBe(-1);
  });

  it("loads the target plus older context, capped at the conversation size", () => {
    expect(getRequiredMessageCount(0, COUNT)).toBe(51); // latest message
    expect(getRequiredMessageCount(200, COUNT)).toBe(251);
    expect(getRequiredMessageCount(COUNT - 1, COUNT)).toBe(COUNT); // earliest message
  });
});

describe("resolveDisplayedMessage", () => {
  it("reports loading until the processed range covers the target", () => {
    const target = rawIndexFor(10, COUNT); // an old message
    const processed = processMessages(raw, OWNER_ID, false, undefined, 50);
    expect(resolveDisplayedMessage(raw, target, processed, 50)).toEqual({ status: "loading" });
  });

  it("resolves a normal message exactly, also with swapped roles", () => {
    const id = messageIdFor(5);
    expect(resolve(id)).toEqual({ status: "exact", displayId: id });
    expect(resolve(id, true)).toEqual({ status: "exact", displayId: id });
  });

  it("maps both halves of an owner translation pair to the displayed bubble", () => {
    // Owner: the Translation metadata is folded into the displayed original RichText
    expect(resolve(special.ownerTranslationOriginalId)).toEqual({
      status: "exact",
      displayId: special.ownerTranslationOriginalId,
    });
    expect(resolve(special.ownerTranslationId)).toEqual({
      status: "merged",
      displayId: special.ownerTranslationOriginalId,
    });
  });

  it("maps both halves of another participant's translation pair to the displayed bubble", () => {
    expect(resolve(special.otherTranslationId)).toEqual({
      status: "exact",
      displayId: special.otherTranslationId,
    });
    expect(resolve(special.otherTranslationOriginalId, true)).toEqual({
      status: "merged",
      displayId: special.otherTranslationId,
    });
  });

  it("flags hidden messages and points at the nearest displayed neighbour", () => {
    const result = resolve(special.albumId);
    expect(result.status).toBe("hidden");
    if (result.status !== "hidden") return;
    expect(result.messageType).toBe("RichText/Media_Album");
    expect(result.displayId).not.toBe(special.albumId);
    const neighbourIndex = findRawMessageIndex(raw, result.displayId!);
    expect(Math.abs(neighbourIndex - findRawMessageIndex(raw, special.albumId))).toBe(1);
  });

  it("never reports a hidden message as found when nothing is displayed", () => {
    const onlyAlbum = [{ ...raw[0], messagetype: "RichText/Media_Album" }];
    const processed = processMessages(onlyAlbum, OWNER_ID, false, undefined, 1);
    expect(resolveDisplayedMessage(onlyAlbum, 0, processed, 1)).toEqual({
      status: "hidden",
      displayId: null,
      messageType: "RichText/Media_Album",
    });
  });
});

describe("buildVirtualRows", () => {
  const processed = processMessages(raw, OWNER_ID, false, undefined, raw.length);
  const { rows, rowIndexByMessageId } = buildVirtualRows(processed);

  it("maps message IDs to row indexes that account for date separators", () => {
    const dateRows = rows.filter((row) => row.type === "date").length;
    expect(dateRows).toBeGreaterThan(1);
    expect(rows.length).toBe(processed.length + dateRows);
    expect(rows[0].type).toBe("date");

    for (const id of [messageIdFor(0), messageIdFor(150), messageIdFor(COUNT - 1)]) {
      const row = rows[rowIndexByMessageId.get(id)!];
      expect(row.type).toBe("message");
      expect((row.content as { id: string }).id).toBe(id);
    }
    // Oldest message first, newest last
    expect(rowIndexByMessageId.get(messageIdFor(0))).toBe(1);
    expect(rowIndexByMessageId.get(messageIdFor(COUNT - 1))).toBe(rows.length - 1);
  });

  it("gives every row a unique, content-based key", () => {
    const keys = rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(`msg:${messageIdFor(7)}`);
  });
});
