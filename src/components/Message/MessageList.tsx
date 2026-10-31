import { Box, Text, Divider, Center, Loader, Group, Stack } from "@mantine/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import type { ProcessedMessage } from "../../types/messages";
import { filterMessages } from "../../utils/messageSearch";
import { buildVirtualRows } from "../../utils/virtualRows";
import {
  DEEP_LINK_MAX_SCROLL_FRAMES,
  DEEP_LINK_SETTLED_FRAMES,
} from "../../constants/deepLink";

/** Asks the list to bring a displayed message to the centre of the viewport. */
export interface MessageScrollRequest {
  requestId: number;
  messageId: string;
}

/** The message a deep link points at. Stays highlighted after navigation completes. */
export interface DeepLinkHighlight {
  requestId: number;
  messageId: string;
  /** The linked message itself is not displayed; this is its nearest neighbour. */
  approximate: boolean;
  /** Navigation has finished scrolling; the highlight flashes once, then stays subtle. */
  settled: boolean;
}

interface MessageListProps {
  messages: ProcessedMessage[];
  isLoadingMore: boolean;
  isRoleSwapped: boolean;
  userDisplayName: string;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  searchQuery?: string;
  highlightedMessageIndex?: number;
  scrollRequest?: MessageScrollRequest | null;
  onScrollRequestComplete?: (requestId: number) => void;
  deepLinkHighlight?: DeepLinkHighlight | null;
  onCopyMessageLink?: (messageId: string) => Promise<boolean>;
}

const DEEP_LINK_FLASH_ANIMATION = "skypelens-deeplink-flash";

export function MessageList({
  messages,
  isLoadingMore,
  isRoleSwapped,
  userDisplayName,
  scrollContainerRef,
  searchQuery = "",
  highlightedMessageIndex,
  scrollRequest,
  onScrollRequestComplete,
  deepLinkHighlight,
  onCopyMessageLink,
}: MessageListProps) {
  const [flashedRequestId, setFlashedRequestId] = useState<number | null>(null);

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    return filterMessages(messages, searchQuery);
  }, [messages, searchQuery]);

  const { rows: virtualItems, rowIndexByMessageId } = useMemo(
    () => buildVirtualRows(filteredMessages),
    [filteredMessages],
  );

  const getItemKey = useCallback(
    (index: number) => virtualItems[index]?.key ?? index,
    [virtualItems],
  );

  const virtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 100,
    overscan: 10,
    getItemKey,
  });

  const targetRowIndex = scrollRequest
    ? rowIndexByMessageId.get(scrollRequest.messageId)
    : undefined;
  const scrollRequestId = scrollRequest?.requestId;

  /**
   * Scrolls the target row to the centre of the viewport. Row heights are estimates
   * until rows render, so the target offset is recomputed every frame and the scroll is
   * corrected until the row is rendered and its position has been stable for a few frames.
   */
  useEffect(() => {
    if (scrollRequestId === undefined || targetRowIndex === undefined) return;

    let frame = 0;
    let settledFrames = 0;
    let rafId = 0;

    const step = () => {
      const scrollElement = scrollContainerRef.current;
      if (!scrollElement) return;
      frame++;

      const desiredOffset = virtualizer.getOffsetForIndex(targetRowIndex, "center")?.[0];
      const isRendered = Boolean(
        scrollElement.querySelector(`[data-index="${targetRowIndex}"]`),
      );

      if (
        desiredOffset !== undefined &&
        isRendered &&
        Math.abs(scrollElement.scrollTop - desiredOffset) <= 1
      ) {
        settledFrames++;
      } else {
        settledFrames = 0;
        if (desiredOffset !== undefined) {
          virtualizer.scrollToOffset(desiredOffset);
        }
      }

      if (
        settledFrames >= DEEP_LINK_SETTLED_FRAMES ||
        frame >= DEEP_LINK_MAX_SCROLL_FRAMES
      ) {
        onScrollRequestComplete?.(scrollRequestId);
        return;
      }
      rafId = requestAnimationFrame(step);
    };

    virtualizer.scrollToIndex(targetRowIndex, { align: "center" });
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [
    scrollRequestId,
    targetRowIndex,
    virtualizer,
    scrollContainerRef,
    onScrollRequestComplete,
  ]);

  if (messages.length === 0) {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text c="dimmed">Loading messages...</Text>
        </Stack>
      </Center>
    );
  }

  if (searchQuery.trim() && filteredMessages.length === 0) {
    return (
      <Center h="100%">
        <Text c="dimmed">No messages found matching &quot;{searchQuery}&quot;</Text>
      </Center>
    );
  }

  return (
    <>
      {isLoadingMore && (
        <Center
          p="xs"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
          bg="light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))"
        >
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="xs" c="dimmed">
              Loading older messages...
            </Text>
          </Group>
        </Center>
      )}

      <div
        style={{
          height: `${virtualizer.getTotalSize() + 24}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = virtualItems[virtualRow.index];
          const isDate = item.type === "date";
          const message = item.content as ProcessedMessage;
          const isDeepLinkTarget =
            !isDate && deepLinkHighlight?.messageId === message.id;
          const isFlashing =
            isDeepLinkTarget &&
            deepLinkHighlight.settled &&
            flashedRequestId !== deepLinkHighlight.requestId;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              data-message-index={item.type === "message" ? item.messageIndex : undefined}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: `${virtualRow.start}px`,
                left: 0,
                width: "100%",
              }}
            >
              {isDate ? (
                <Box py={24} px={12}>
                  <Divider
                    label={
                      <Text size="xs" fw={600} c="dimmed">
                        {item.content as string}
                      </Text>
                    }
                    labelPosition="center"
                  />
                </Box>
              ) : (
                <div
                  data-message-id={message.id}
                  data-deeplink-target={isDeepLinkTarget || undefined}
                  className={[
                    "skypelens-message-row",
                    isDeepLinkTarget && "skypelens-deeplink-target",
                    isDeepLinkTarget &&
                      deepLinkHighlight.approximate &&
                      "skypelens-deeplink-approximate",
                    isFlashing && "skypelens-deeplink-flash",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onAnimationEnd={
                    isFlashing
                      ? (event) => {
                          if (event.animationName === DEEP_LINK_FLASH_ANIMATION) {
                            setFlashedRequestId(deepLinkHighlight.requestId);
                          }
                        }
                      : undefined
                  }
                >
                  <MessageBubble
                    message={message}
                    showSender={item.showSender}
                    showTimestamp={item.showTimestamp}
                    isRoleSwapped={isRoleSwapped}
                    userDisplayName={userDisplayName}
                    searchQuery={searchQuery}
                    isHighlighted={
                      item.messageIndex !== undefined &&
                      item.messageIndex === highlightedMessageIndex
                    }
                    onCopyLink={onCopyMessageLink}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
