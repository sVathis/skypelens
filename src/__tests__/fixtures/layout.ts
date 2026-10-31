/**
 * Minimal deterministic layout for jsdom, which has none: the message scroll container
 * is VIEWPORT_HEIGHT tall, message rows MESSAGE_ROW_HEIGHT, date rows DATE_ROW_HEIGHT.
 * scrollTop is clamped like a browser and fires a "scroll" event asynchronously.
 */
export const VIEWPORT_HEIGHT = 600;
export const MESSAGE_ROW_HEIGHT = 48;
export const DATE_ROW_HEIGHT = 72;

const scrollTops = new WeakMap<Element, number>();

const isContainer = (el: Element) => el.hasAttribute("data-message-scroll-container");

function heightOf(el: Element): number {
  if (isContainer(el)) return VIEWPORT_HEIGHT;
  if (el.hasAttribute("data-index")) {
    return el.querySelector("[data-message-id]") ? MESSAGE_ROW_HEIGHT : DATE_ROW_HEIGHT;
  }
  return 0;
}

function scrollHeightOf(el: Element): number {
  if (!isContainer(el)) return heightOf(el);
  let total = 0;
  for (const child of Array.from(el.children)) {
    total += parseFloat((child as HTMLElement).style.height) || 0;
  }
  return Math.max(total, VIEWPORT_HEIGHT);
}

export function installLayout(): () => void {
  const proto = HTMLElement.prototype;
  // clientHeight, scrollHeight and scrollTop live on Element.prototype in jsdom, so the
  // overrides below shadow them and deleting the overrides restores them.
  const originals = {
    offsetHeight: Object.getOwnPropertyDescriptor(proto, "offsetHeight"),
    getBoundingClientRect: proto.getBoundingClientRect,
    scrollTo: (proto as { scrollTo?: unknown }).scrollTo,
  };

  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return heightOf(this);
    },
  });
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return heightOf(this);
    },
  });
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return scrollHeightOf(this);
    },
  });
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      const max = Math.max(0, scrollHeightOf(this) - heightOf(this));
      const next = Math.max(0, Math.min(max, value));
      if (next === (scrollTops.get(this) ?? 0)) return;
      scrollTops.set(this, next);
      queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
    },
  });
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const height = heightOf(this);
    return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: height, width: 800, height, toJSON() {} } as DOMRect;
  };
  proto.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === "object" && options?.top !== undefined) this.scrollTop = options.top;
  } as typeof proto.scrollTo;

  const globals = globalThis as Record<string, unknown>;
  const previousResizeObserver = globals.ResizeObserver;
  const previousMatchMedia = window.matchMedia;
  globals.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList;

  return () => {
    if (originals.offsetHeight) {
      Object.defineProperty(proto, "offsetHeight", originals.offsetHeight);
    }
    delete (proto as unknown as Record<string, unknown>).clientHeight;
    delete (proto as unknown as Record<string, unknown>).scrollHeight;
    delete (proto as unknown as Record<string, unknown>).scrollTop;
    proto.getBoundingClientRect = originals.getBoundingClientRect;
    (proto as { scrollTo?: unknown }).scrollTo = originals.scrollTo;
    globals.ResizeObserver = previousResizeObserver;
    window.matchMedia = previousMatchMedia;
  };
}
