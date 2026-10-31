import { describe, expect, it } from "vitest";
import { normalizeSkypeExport, parseJsonFile } from "../utils/fileParser";
import {
  CONVERSATION_ID,
  OWNER_ID,
  createSyntheticConversation,
  createSyntheticExport,
} from "./fixtures/syntheticExport";

describe("normalizeSkypeExport", () => {
  it("passes a full Skype export through unchanged", () => {
    const { exportData } = createSyntheticExport(50);
    expect(normalizeSkypeExport(exportData)).toBe(exportData);
  });

  it("accepts a bare extracted conversation and keeps its IDs", () => {
    const { conversation } = createSyntheticConversation(50);
    const normalized = normalizeSkypeExport(JSON.parse(JSON.stringify(conversation)));

    expect(normalized.conversations).toHaveLength(1);
    expect(normalized.conversations[0].id).toBe(CONVERSATION_ID);
    expect(normalized.conversations[0].MessageList.map((m) => m.id)).toEqual(
      conversation.MessageList.map((m) => m.id),
    );
    // In a 1:1 chat the conversation ID is the other person, so the owner is the other sender
    expect(normalized.userId).toBe(OWNER_ID);
  });

  it("fills in conversation fields a minimal extraction may omit", () => {
    const { conversation } = createSyntheticConversation(10);
    const normalized = normalizeSkypeExport({
      id: conversation.id,
      MessageList: conversation.MessageList,
    });
    const [result] = normalized.conversations;
    expect(result.displayName).toBe(conversation.id);
    expect(result.threadProperties).toBeNull();
    expect(result.properties.conversationblocked).toBe(false);
  });

  it("infers the owner when an export has conversations but no userId", () => {
    const { exportData } = createSyntheticExport(50);
    const withoutUser = { conversations: exportData.conversations };
    expect(normalizeSkypeExport(withoutUser).userId).toBe(OWNER_ID);
  });

  it.each([null, [], {}, { id: "x" }, { MessageList: [] }, "text"])(
    "rejects %o",
    (input) => {
      expect(() => normalizeSkypeExport(input)).toThrow(/Invalid Skype export/);
    },
  );

  it("is applied when uploading a file", async () => {
    const { conversation } = createSyntheticConversation(20);
    const file = new File([JSON.stringify(conversation)], "conversation.json", {
      type: "application/json",
    });
    const data = await parseJsonFile(file, () => {});
    expect(data.conversations[0].id).toBe(CONVERSATION_ID);
    expect(data.userId).toBe(OWNER_ID);
  });
});
