// Query parameter names of the canonical deep-link URL:
// <app base>?conversationId=<Conversation.id>&messageId=<Message.id>
export const CONVERSATION_ID_PARAM = "conversationId";
export const MESSAGE_ID_PARAM = "messageId";

// Upper bound for a single identifier taken from the URL. Real Skype IDs are far shorter.
export const MAX_DEEP_LINK_ID_LENGTH = 1024;

// Older messages loaded beyond the target so it has context above it.
export const DEEP_LINK_CONTEXT_MESSAGES = 50;

// Consecutive animation frames the target must stay centred before navigation is complete.
export const DEEP_LINK_SETTLED_FRAMES = 3;
// Upper bound on frames spent converging on the target (about 2s at 60fps).
export const DEEP_LINK_MAX_SCROLL_FRAMES = 120;

export const COPY_FEEDBACK_DURATION = 1500;

export const TAB_BRIDGE_CHANNEL = "skypelens-deep-links-v1";
