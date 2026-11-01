import { useCallback, useEffect, useRef, useState } from "react";
import { useMessageStore } from "../store/messageStore";
import {
  buildDeepLinkUrl,
  getAppBaseUrl,
  parseDeepLinkLocation,
  type DeepLinkLocation,
  type DeepLinkTarget,
} from "../utils/deepLink";
import { createTabBridge, type ExportCopyState, type TabBridge } from "../utils/tabBridge";
import { connectExportBroker } from "../utils/connectExportBroker";
import { randomId } from "../utils/random";
import {
  CONVERSATION_ID_PARAM,
  REPORT_TAB_NAME,
  TAB_BRIDGE_CHANNEL,
} from "../constants/deepLink";
import { canShowDeepLink } from "../utils/messageLocator";

// The parts of the Navigation API used here (not yet in TypeScript's DOM types)
interface SameDocumentNavigateEvent extends Event {
  navigationType: "push" | "replace" | "reload" | "traverse";
  destination: { url: string; sameDocument: boolean };
}
interface WindowWithNavigation extends Window {
  navigation?: {
    addEventListener(type: "navigate", listener: (event: SameDocumentNavigateEvent) => void): void;
    removeEventListener(type: "navigate", listener: (event: SameDocumentNavigateEvent) => void): void;
  };
}

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

/** A request from another tab for this tab's export, waiting for the user's answer. */
export interface ExportApprovalRequest {
  code: string;
  target: DeepLinkTarget;
  respond: (allowed: boolean) => void;
}

/**
 * Keeps the URL and the store in sync and passes links (or, with the user's approval,
 * a copy of the export to the report's tab) between SkypeLens tabs. Returns:
 * - `forwardedTarget`: the deep link this tab handed over to another tab, while it has
 *   no export;
 * - `exportCopy`: progress of an export copy this tab asked for, while it has none;
 * - `approvalRequest`: another tab asking for this tab's export.
 */
export function useDeepLinkNavigation(): {
  forwardedTarget: DeepLinkTarget | null;
  exportCopy: ExportCopyState;
  approvalRequest: ExportApprovalRequest | null;
} {
  const [forwardedTarget, setForwardedTarget] = useState<DeepLinkTarget | null>(null);
  const [exportCopy, setExportCopy] = useState<ExportCopyState>(null);
  const [approvalRequest, setApprovalRequest] = useState<ExportApprovalRequest | null>(null);
  const bridgeRef = useRef<TabBridge | null>(null);
  const hasExport = useMessageStore((state) => state.exportData !== null);
  const requestedDeepLink = useMessageStore((state) => state.requestedDeepLink);

  useEffect(() => {
    const handleLocationChange = () => syncFromLocation();
    // Following the link this tab is already at (e.g. clicking the same report finding
    // again after scrolling away) leaves the URL unchanged, so neither "hashchange" nor
    // (in Firefox) "popstate" fires. The Navigation API still reports it. Our own
    // history.pushState/replaceState calls never keep the same URL, so they don't
    // trigger this.
    const handleNavigate = (event: SameDocumentNavigateEvent) => {
      const isRepeat =
        event.destination.sameDocument &&
        event.destination.url === window.location.href &&
        (event.navigationType === "push" || event.navigationType === "replace");
      if (isRepeat) syncFromLocation({ force: true });
    };
    const navigation = (window as WindowWithNavigation).navigation;

    syncFromLocation({ force: true });
    // Back/Forward fires "popstate"; a report link aimed at this tab that changes
    // only the hash fires "hashchange" (and in most browsers "popstate" too).
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("hashchange", handleLocationChange);
    navigation?.addEventListener("navigate", handleNavigate);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("hashchange", handleLocationChange);
      navigation?.removeEventListener("navigate", handleNavigate);
    };
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    const tabId = randomId();
    const broker = connectExportBroker(tabId);
    const bridge = createTabBridge({
      channel: new BroadcastChannel(TAB_BRIDGE_CHANNEL),
      tabId,
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
      exportTransfer: broker
        ? {
            broker,
            // Only the tab report.html links go to asks for a copy: the report keeps
            // reusing it. Other fresh tabs (report.md links, pasted links) hand the link
            // over instead of adding another copy of the export each.
            wantsExport: () => window.name === REPORT_TAB_NAME,
            getExport: () => useMessageStore.getState().exportData,
            exportHas: (data, target) => canShowDeepLink(data.conversations, target),
            approve: (request, signal) =>
              new Promise<boolean>((resolve) => {
                const answer = (allowed: boolean) => {
                  setApprovalRequest((current) => (current?.respond === answer ? null : current));
                  resolve(allowed);
                };
                // The asking tab gave up (newer link, timeout, closed)
                signal.addEventListener("abort", () => answer(false));
                setApprovalRequest({ ...request, respond: answer });
              }),
            onCopyStateChange: setExportCopy,
            onExportReceived: (data) => {
              const store = useMessageStore.getState();
              // Opens the link this tab asks for now, which may be newer than the one
              // the copy was first asked for
              if (!store.exportData) store.setExportData(data);
            },
          }
        : undefined,
    });
    bridgeRef.current = bridge;

    return () => {
      bridge.close();
      broker?.close();
      bridgeRef.current = null;
    };
  }, []);

  // A fresh tab with a deep link but no export asks other tabs to show it
  useEffect(() => {
    if (!hasExport && requestedDeepLink) {
      setForwardedTarget(null);
      setExportCopy((state) => (state?.phase === "failed" ? null : state));
      bridgeRef.current?.offer(requestedDeepLink);
    }
  }, [hasExport, requestedDeepLink]);

  return hasExport
    ? { forwardedTarget: null, exportCopy: null, approvalRequest }
    : { forwardedTarget, exportCopy, approvalRequest: null };
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
