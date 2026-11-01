import { create } from "zustand";
import type {
  Conversation,
  SkypeExport,
  ProcessedMessage,
} from "../types/messages";
import { debugLog } from "../utils/debug";
import type { DeepLinkTarget } from "../utils/deepLink";
import { findRawMessageIndex } from "../utils/messageLocator";

interface ProcessedMessagesCache {
  [conversationId: string]: {
    normal: ProcessedMessage[];
    swapped: ProcessedMessage[];
  };
}

export type NavigationErrorKind =
  | "invalid-link"
  | "conversation-not-found"
  | "conversation-empty"
  | "message-not-found";

export interface NavigationError {
  kind: NavigationErrorKind;
  message: string;
}

/** A deep-link target resolved against the loaded export. */
export interface NavigationTarget {
  /** Increments for every navigation, so repeated links to the same message re-run. */
  requestId: number;
  conversationId: string;
  /** Original Skype message ID that was requested. */
  messageId: string;
  /** Position of the message in `Conversation.MessageList`. */
  rawIndex: number;
  /** "pending" until the message list has scrolled to and highlighted the target. */
  status: "pending" | "done";
}

interface MessageStore {
  conversations: Conversation[];
  selectedConversationId: string | null;
  exportData: SkypeExport | null;
  swappedRoles: Record<string, boolean>;
  processedMessagesCache: ProcessedMessagesCache;
  /**
   * The deep link the URL currently asks for. Kept after it is resolved (or fails to
   * resolve), so loading a different export re-resolves it. While no export is
   * loaded, it is the link waiting for one.
   */
  requestedDeepLink: DeepLinkTarget | null;
  navigationTarget: NavigationTarget | null;
  navigationError: NavigationError | null;
  navigationRequestCount: number;
  setExportData: (data: SkypeExport) => void;
  /** Forgets the loaded export (to load another one); keeps the requested link. */
  unloadExport: () => void;
  selectConversation: (id: string) => void;
  getSelectedConversation: () => Conversation | null;
  toggleRoleSwap: (conversationId: string) => void;
  isRoleSwapped: (conversationId: string) => boolean;
  cacheProcessedMessages: (
    conversationId: string,
    messages: ProcessedMessage[],
    isSwapped: boolean,
  ) => void;
  getProcessedMessages: (
    conversationId: string,
    isSwapped: boolean,
  ) => ProcessedMessage[] | null;
  requestNavigation: (target: DeepLinkTarget) => void;
  /** Scrolls to the current navigation target again (e.g. after a role swap). */
  renavigate: () => void;
  completeNavigation: (requestId: number) => void;
  clearNavigation: () => void;
  setNavigationError: (error: NavigationError | null) => void;
}

type NavigationState = Pick<
  MessageStore,
  | "selectedConversationId"
  | "navigationTarget"
  | "navigationError"
  | "navigationRequestCount"
>;

/**
 * Resolves a deep link against the loaded export: exact conversation ID, then exact
 * message ID. Never falls back to a different conversation or message silently.
 */
function resolveDeepLink(
  target: DeepLinkTarget,
  exportData: SkypeExport,
  conversations: Conversation[],
  currentSelection: string | null,
  requestCount: number,
): NavigationState {
  const requestId = requestCount + 1;
  const base = {
    navigationTarget: null,
    navigationRequestCount: requestId,
  };

  const conversation = conversations.find((c) => c.id === target.conversationId);
  if (!conversation) {
    const existsButEmpty = exportData.conversations.some(
      (c) => c.id === target.conversationId,
    );
    return {
      ...base,
      selectedConversationId: currentSelection,
      navigationError: existsButEmpty
        ? {
            kind: "conversation-empty",
            message: `Conversation "${target.conversationId}" exists in this export but has no messages.`,
          }
        : {
            kind: "conversation-not-found",
            message: `Conversation "${target.conversationId}" was not found in the loaded export. Make sure you loaded the export the link was created from.`,
          },
    };
  }

  if (target.messageId === null) {
    return { ...base, selectedConversationId: conversation.id, navigationError: null };
  }

  const rawIndex = findRawMessageIndex(conversation.MessageList, target.messageId);
  if (rawIndex === -1) {
    return {
      ...base,
      selectedConversationId: conversation.id,
      navigationError: {
        kind: "message-not-found",
        message: `Message "${target.messageId}" was not found in this conversation. It may have been deleted or the link may come from a different export.`,
      },
    };
  }

  debugLog("[messageStore] Resolved deep link:", {
    conversationId: conversation.id,
    messageId: target.messageId,
    rawIndex,
  });

  return {
    ...base,
    selectedConversationId: conversation.id,
    navigationError: null,
    navigationTarget: {
      requestId,
      conversationId: conversation.id,
      messageId: target.messageId,
      rawIndex,
      status: "pending",
    },
  };
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  conversations: [],
  selectedConversationId: null,
  exportData: null,
  swappedRoles: {},
  processedMessagesCache: {},
  requestedDeepLink: null,
  navigationTarget: null,
  navigationError: null,
  navigationRequestCount: 0,

  setExportData: (data) => {
    const filteredConversations = data.conversations.filter(
      (conv) => conv.MessageList?.length > 0,
    );

    filteredConversations.sort((a, b) => {
      const aLastMessage = a.MessageList[a.MessageList.length - 1];
      const bLastMessage = b.MessageList[b.MessageList.length - 1];

      if (!aLastMessage) return 1;
      if (!bLastMessage) return -1;

      const aTime = new Date(aLastMessage.originalarrivaltime).getTime();
      const bTime = new Date(bLastMessage.originalarrivaltime).getTime();
      return bTime - aTime;
    });

    const selectedId = filteredConversations[0]?.id || null;
    const { requestedDeepLink, navigationRequestCount, navigationError } = get();

    // Complete the link in the URL: opened before any export was loaded, or not
    // found in the previously loaded export
    const navigation: Partial<NavigationState> = requestedDeepLink
      ? resolveDeepLink(
          requestedDeepLink,
          data,
          filteredConversations,
          selectedId,
          navigationRequestCount,
        )
      : {
          navigationTarget: null,
          // A malformed link is still worth reporting once the export is loaded
          navigationError: navigationError?.kind === "invalid-link" ? navigationError : null,
        };

    set({
      exportData: data,
      conversations: filteredConversations,
      selectedConversationId: selectedId,
      processedMessagesCache: {},
      ...navigation,
    });
  },

  unloadExport: () => {
    set({
      exportData: null,
      conversations: [],
      selectedConversationId: null,
      swappedRoles: {},
      processedMessagesCache: {},
      navigationTarget: null,
      navigationError: null,
    });
  },

  selectConversation: (id) => {
    debugLog("[messageStore] Selecting conversation:", { conversationId: id });
    set((state) => ({
      selectedConversationId: id,
      // A target in another conversation no longer applies
      navigationTarget:
        state.navigationTarget?.conversationId === id ? state.navigationTarget : null,
      navigationError: null,
    }));
  },

  getSelectedConversation: () => {
    const { conversations, selectedConversationId } = get();
    return conversations.find((c) => c.id === selectedConversationId) || null;
  },

  toggleRoleSwap: (conversationId) => {
    set((state) => {
      const newCache = { ...state.processedMessagesCache };
      delete newCache[conversationId];
      const newSwappedState = !state.swappedRoles[conversationId];

      return {
        swappedRoles: {
          ...state.swappedRoles,
          [conversationId]: newSwappedState,
        },
        processedMessagesCache: newCache,
      };
    });
  },

  isRoleSwapped: (conversationId) => {
    return get().swappedRoles[conversationId] || false;
  },

  cacheProcessedMessages: (conversationId, messages, isSwapped) => {
    set((state) => ({
      processedMessagesCache: {
        ...state.processedMessagesCache,
        [conversationId]: {
          ...state.processedMessagesCache[conversationId],
          [isSwapped ? "swapped" : "normal"]: messages,
        },
      },
    }));
  },

  getProcessedMessages: (conversationId, isSwapped) => {
    const cache = get().processedMessagesCache[conversationId];
    return cache?.[isSwapped ? "swapped" : "normal"] ?? null;
  },

  requestNavigation: (target) => {
    const { exportData, conversations, selectedConversationId, navigationRequestCount } =
      get();

    if (!exportData) {
      set({ requestedDeepLink: target, navigationTarget: null, navigationError: null });
      return;
    }

    set({
      requestedDeepLink: target,
      ...resolveDeepLink(
        target,
        exportData,
        conversations,
        selectedConversationId,
        navigationRequestCount,
      ),
    });
  },

  renavigate: () => {
    set((state) =>
      state.navigationTarget
        ? {
            navigationRequestCount: state.navigationRequestCount + 1,
            navigationTarget: {
              ...state.navigationTarget,
              requestId: state.navigationRequestCount + 1,
              status: "pending",
            },
          }
        : {},
    );
  },

  completeNavigation: (requestId) => {
    set((state) =>
      state.navigationTarget?.requestId === requestId &&
      state.navigationTarget.status === "pending"
        ? { navigationTarget: { ...state.navigationTarget, status: "done" } }
        : {},
    );
  },

  clearNavigation: () => {
    set({ requestedDeepLink: null, navigationTarget: null, navigationError: null });
  },

  setNavigationError: (error) => {
    set({ navigationError: error });
  },
}));

export const useConversations = () =>
  useMessageStore((state) => state.conversations);
export const useSelectedConversationId = () =>
  useMessageStore((state) => state.selectedConversationId);
export const useExportData = () => useMessageStore((state) => state.exportData);
export const useSelectConversation = () =>
  useMessageStore((state) => state.selectConversation);

// Lets the browser tests (e2e/) inspect the loaded export. Development server only:
// import.meta.env.DEV is false in production builds, which drop this.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as Window & { __SKYPELENS_STORE__?: typeof useMessageStore }).__SKYPELENS_STORE__ =
    useMessageStore;
}
