import { useState, useEffect, startTransition } from "react";
import { processMessages } from "../utils/messageProcessor";
import type { ProcessedMessage, Conversation, SkypeExport } from "../types/messages";
import { INITIAL_MESSAGE_COUNT } from "../constants/messages";

interface UseMessageProcessingProps {
  conversation: Conversation | null;
  exportData: SkypeExport | null;
  swapped: boolean;
  getProcessedMessages: (
    conversationId: string,
    isSwapped: boolean,
  ) => ProcessedMessage[] | null;
  cacheProcessedMessages: (
    conversationId: string,
    messages: ProcessedMessage[],
    isSwapped: boolean,
  ) => void;
}

interface ProcessedState {
  /** Which conversation and perspective `messages` belong to (see getProcessingKey). */
  key: string | null;
  messages: ProcessedMessage[];
  /** Number of raw messages (from the start of MessageList) that `messages` covers. */
  rawCount: number;
}

const EMPTY_STATE: ProcessedState = { key: null, messages: [], rawCount: 0 };

export function getProcessingKey(conversationId: string, swapped: boolean): string {
  return `${swapped ? "swapped" : "normal"}:${conversationId}`;
}

/**
 * Processes messages for display with caching support.
 * Caches processed messages to avoid reprocessing on re-renders.
 * Handles incremental loading and role swapping.
 */
export function useMessageProcessing({
  conversation,
  exportData,
  swapped,
  getProcessedMessages,
  cacheProcessedMessages,
}: UseMessageProcessingProps) {
  const [processedState, setProcessedState] = useState<ProcessedState>(EMPTY_STATE);
  const [loadedMessageCount, setLoadedMessageCount] = useState(
    INITIAL_MESSAGE_COUNT,
  );

  useEffect(() => {
    if (conversation) {
      setLoadedMessageCount(INITIAL_MESSAGE_COUNT);
    }
  }, [conversation, swapped]);

  useEffect(() => {
    if (
      !conversation?.id ||
      !conversation?.MessageList ||
      !exportData?.userId
    ) {
      startTransition(() => setProcessedState(EMPTY_STATE));
      return;
    }

    const key = getProcessingKey(conversation.id, swapped);
    const cachedAll = getProcessedMessages(conversation.id, swapped);
    const totalMessages = conversation.MessageList.length;
    const messagesToLoad = Math.min(loadedMessageCount, totalMessages);

    // Processing skips some raw messages, so the first N processed messages always
    // cover at least the first N raw messages.
    if (cachedAll && cachedAll.length >= messagesToLoad) {
      startTransition(() =>
        setProcessedState({
          key,
          messages: cachedAll.slice(0, messagesToLoad),
          rawCount: messagesToLoad,
        }),
      );
      return;
    }

    const timeoutId = setTimeout(() => {
      const processed = processMessages(
        conversation.MessageList,
        exportData.userId,
        swapped,
        exportData.mediaFiles,
        messagesToLoad,
      );
      cacheProcessedMessages(conversation.id, processed, swapped);
      startTransition(() =>
        setProcessedState({ key, messages: processed, rawCount: messagesToLoad }),
      );
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [
    conversation?.id,
    conversation?.MessageList,
    exportData?.userId,
    exportData?.mediaFiles,
    swapped,
    loadedMessageCount,
    getProcessedMessages,
    cacheProcessedMessages,
  ]);

  return {
    processedMessages: processedState.messages,
    processedKey: processedState.key,
    processedRawCount: processedState.rawCount,
    loadedMessageCount,
    setLoadedMessageCount,
  };
}
