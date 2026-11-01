import type { Page } from "@playwright/test";
import type { DeepLinkTarget } from "../src/utils/deepLink";

// Built like tools/skypelens_links.py does (base URL kept byte for byte, IDs in the
// hash), independently of SkypeLens' own buildDeepLinkUrl
export const pythonStyleUrl = (baseUrl: string, { conversationId, messageId }: DeepLinkTarget) =>
  `${baseUrl}#conversationId=${encodeURIComponent(conversationId)}&messageId=${encodeURIComponent(messageId ?? "")}`;

/**
 * A synthetic report.html. Links use the markup of finding_links_html() (its tests pin
 * it): a named target and no rel="noopener"/"noreferrer". `target` overrides that,
 * e.g. "_blank" for a link that opens a new tab each time, like report.md links.
 */
export function reportHtml(baseUrl: string, links: { target: DeepLinkTarget; tab?: string }[]) {
  const items = links.map(({ target, tab = "skypelens" }) => {
    const href = pythonStyleUrl(baseUrl, target).replaceAll("&", "&amp;");
    return `<li><a class="skypelens-link" href="${href}" target="${tab}">View in SkypeLens</a></li>`;
  });
  return `<!doctype html><meta charset="utf-8"><title>Synthetic report</title><ul>${items.join("")}</ul>`;
}

export const linkedMessage = (page: Page, messageId: string | null) =>
  page.locator(`[data-deeplink-target][data-message-id="${messageId}"]`);
export const uploadInput = (page: Page) => page.locator('input[type="file"][accept]');
export const beforeHash = (url: string) => url.split("#")[0];

// Survives only as long as the tab is never reloaded
export const markTab = (page: Page) =>
  page.evaluate(() => ((window as Window & { e2eMarker?: string }).e2eMarker = "not reloaded"));
export const readMark = (page: Page) =>
  page.evaluate(() => (window as Window & { e2eMarker?: string }).e2eMarker);
