import { ActionIcon, Tooltip } from "@mantine/core";
import { IconCheck, IconLink } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { COPY_FEEDBACK_DURATION } from "../../constants/deepLink";

interface CopyMessageLinkButtonProps {
  messageId: string;
  onCopy: (messageId: string) => Promise<boolean>;
  /** Side of the bubble to sit on, outside it. The bubble must be `position: relative`. */
  placement: "start" | "end";
}

const PLACEMENT_STYLES: Record<CopyMessageLinkButtonProps["placement"], React.CSSProperties> = {
  start: { position: "absolute", right: "100%", top: "50%", transform: "translateY(-50%)", marginRight: 4 },
  end: { position: "absolute", left: "100%", top: "50%", transform: "translateY(-50%)", marginLeft: 4 },
};

/**
 * Discreet "Copy link to message" action. Hidden until the message row is hovered or the
 * button is focused (always faintly visible on touch devices).
 */
export function CopyMessageLinkButton({
  messageId,
  onCopy,
  placement,
}: CopyMessageLinkButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timeoutId = setTimeout(() => setStatus("idle"), COPY_FEEDBACK_DURATION);
    return () => clearTimeout(timeoutId);
  }, [status]);

  const handleClick = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setStatus((await onCopy(messageId)) ? "copied" : "failed");
  };

  const label =
    status === "copied"
      ? "Link copied"
      : status === "failed"
        ? "Could not copy link"
        : "Copy link to message";

  return (
    <Tooltip label={label} opened={status !== "idle" ? true : undefined} withArrow position="top">
      <ActionIcon
        className="skypelens-copy-link"
        data-active={status !== "idle" || undefined}
        variant="subtle"
        color={status === "failed" ? "red" : status === "copied" ? "teal" : "gray"}
        size="sm"
        radius="xl"
        aria-label="Copy link to message"
        onClick={handleClick}
        style={PLACEMENT_STYLES[placement]}
      >
        {status === "copied" ? <IconCheck size={14} /> : <IconLink size={14} />}
      </ActionIcon>
    </Tooltip>
  );
}
