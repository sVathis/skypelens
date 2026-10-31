import { useCallback, useEffect, useRef, useState } from "react";
import { useMessageStore } from "../store/messageStore";
import {
  buildDeepLinkUrl,
  getAppBaseUrl,
  parseDeepLink,
  type DeepLinkTarget,
} from "../utils/deepLink";
import { createTabBridge, type TabBridge } from "../utils/tabBridge";
import { TAB_BRIDGE_CHANNEL } from "../constants/deepLink";

function pushUrl(url: string) {
  if (url !== window.location.href) {
    window.history.pushState(null, "", url);
  }
}

/**
 * Applies the deep link in the current URL to the store. Runs on start-up and on
 * browser Back/Forward, so history entries created by conversation clicks or forwarded
 * links can be revisited.
 */
export function applyLocationToStore(search: string = window.location.search) {
  const { requestNavigation, clearNavigation, setNavigationError } =
    useMessageStore.getState();
  const result = parseDeepLink(search);

  if (result.kind === "valid") {
    requestNavigation(result.target);
  } else if (result.kind === "invalid") {
    clearNavigation();
    setNavigationError({ kind: "invalid-link", message: result.reason });
  } else {
    clearNavigation();
  }
}

/**
 * Keeps the URL and the store in sync and forwards links between SkypeLens tabs.
 * Returns the deep link this tab handed over to another tab, if any.
 */
export function useDeepLinkNavigation(): { forwardedTarget: DeepLinkTarget | null } {
  const [forwardedTarget, setForwardedTarget] = useState<DeepLinkTarget | null>(null);
  const bridgeRef = useRef<TabBridge | null>(null);
  const hasExport = useMessageStore((state) => state.exportData !== null);
  const pendingDeepLink = useMessageStore((state) => state.pendingDeepLink);

  useEffect(() => {
    const handlePopState = () => applyLocationToStore();
    applyLocationToStore();
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    const bridge = createTabBridge({
      channel: new BroadcastChannel(TAB_BRIDGE_CHANNEL),
      canHandle: (target) =>
        useMessageStore
          .getState()
          .conversations.some((c) => c.id === target.conversationId),
      onNavigate: (target) => {
        pushUrl(buildDeepLinkUrl(target, getAppBaseUrl()));
        useMessageStore.getState().requestNavigation(target);
        window.focus();
      },
      onForwarded: (target) => {
        // Only relevant while this tab is still waiting for an export
        if (!useMessageStore.getState().exportData) {
          setForwardedTarget(target);
        }
      },
    });
    bridgeRef.current = bridge;

    return () => {
      bridge.close();
      bridgeRef.current = null;
    };
  }, []);

  // A fresh tab with a deep link but no export asks other tabs to show it
  useEffect(() => {
    if (!hasExport && pendingDeepLink) {
      setForwardedTarget(null);
      bridgeRef.current?.offer(pendingDeepLink);
    }
  }, [hasExport, pendingDeepLink]);

  return { forwardedTarget: hasExport ? null : forwardedTarget };
}

/**
 * Selects a conversation from a user action and records it in browser history,
 * so Back returns to the previously viewed conversation or linked message.
 */
export function useOpenConversation() {
  const selectConversation = useMessageStore((state) => state.selectConversation);

  return useCallback(
    (conversationId: string) => {
      selectConversation(conversationId);
      pushUrl(buildDeepLinkUrl({ conversationId, messageId: null }, getAppBaseUrl()));
    },
    [selectConversation],
  );
}
