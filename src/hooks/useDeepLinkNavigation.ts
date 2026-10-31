import { useCallback, useEffect, useRef, useState } from "react";
import { useMessageStore } from "../store/messageStore";
import {
  buildDeepLinkUrl,
  getAppBaseUrl,
  parseDeepLinkLocation,
  type DeepLinkLocation,
  type DeepLinkTarget,
} from "../utils/deepLink";
import { createTabBridge, type TabBridge } from "../utils/tabBridge";
import { CONVERSATION_ID_PARAM, TAB_BRIDGE_CHANNEL } from "../constants/deepLink";
import { canShowDeepLink } from "../utils/messageLocator";

// The URL last applied to (or written from) the store. A hash change can fire both
// "popstate" and "hashchange"; this keeps it from being applied twice.
let lastSyncedHref: string | null = null;

function pushUrl(url: string) {
  if (url !== window.location.href) {
    window.history.pushState(null, "", url);
  }
  lastSyncedHref = window.location.href;
}

/**
 * Applies the deep link in a URL to the store. Runs on start-up, on browser
 * Back/Forward and when a link changes the hash of an open SkypeLens tab.
 */
export function applyLocationToStore(location: DeepLinkLocation = window.location) {
  const { requestNavigation, clearNavigation, setNavigationError } =
    useMessageStore.getState();
  const result = parseDeepLinkLocation(location);

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
 * Applies the current URL unless it was already applied. Rewrites an older
 * `?conversationId=…` link to the `#conversationId=…` form first, so this tab's URL has
 * no link parameters in the query and later links only change the hash (no reload).
 */
function syncFromLocation({ force = false } = {}) {
  const result = parseDeepLinkLocation(window.location);
  const isQueryForm = new URLSearchParams(window.location.search).has(CONVERSATION_ID_PARAM);
  if (result.kind === "valid" && isQueryForm) {
    window.history.replaceState(window.history.state, "", buildDeepLinkUrl(result.target));
  }

  if (!force && window.location.href === lastSyncedHref) return;
  lastSyncedHref = window.location.href;
  applyLocationToStore();
}

/**
 * Keeps the URL and the store in sync and forwards links between SkypeLens tabs.
 * Returns the deep link this tab handed over to another tab, if any.
 */
export function useDeepLinkNavigation(): { forwardedTarget: DeepLinkTarget | null } {
  const [forwardedTarget, setForwardedTarget] = useState<DeepLinkTarget | null>(null);
  const bridgeRef = useRef<TabBridge | null>(null);
  const hasExport = useMessageStore((state) => state.exportData !== null);
  const requestedDeepLink = useMessageStore((state) => state.requestedDeepLink);

  useEffect(() => {
    const handleLocationChange = () => syncFromLocation();
    syncFromLocation({ force: true });
    // Back/Forward fires "popstate"; a report link aimed at this tab that changes
    // only the hash fires "hashchange" (and in most browsers "popstate" too).
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("hashchange", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("hashchange", handleLocationChange);
    };
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    const bridge = createTabBridge({
      channel: new BroadcastChannel(TAB_BRIDGE_CHANNEL),
      // Claim only if this export has the message, not just the conversation
      canHandle: (target) =>
        canShowDeepLink(useMessageStore.getState().conversations, target),
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
    if (!hasExport && requestedDeepLink) {
      setForwardedTarget(null);
      bridgeRef.current?.offer(requestedDeepLink);
    }
  }, [hasExport, requestedDeepLink]);

  return { forwardedTarget: hasExport ? null : forwardedTarget };
}

/**
 * Opens a conversation from a user action and records it in browser history, so Back
 * returns to the previously viewed conversation or linked message. Goes through
 * requestNavigation so the store's requested link keeps matching the URL.
 */
export function useOpenConversation() {
  const requestNavigation = useMessageStore((state) => state.requestNavigation);

  return useCallback(
    (conversationId: string) => {
      const target = { conversationId, messageId: null };
      requestNavigation(target);
      pushUrl(buildDeepLinkUrl(target, getAppBaseUrl()));
    },
    [requestNavigation],
  );
}
