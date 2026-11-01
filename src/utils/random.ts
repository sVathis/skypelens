// crypto.getRandomValues, unlike crypto.randomUUID, also works outside secure contexts,
// e.g. SkypeLens opened at http://<LAN address>:5173

/** A random 128-bit identifier, as hex. */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// No 0/O, 1/I/L, so the code is easy to compare between two tabs
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** A short code such as "K7Q-4MZ" that two tabs both display (about 30 bits). */
export function randomCode(): string {
  const values = crypto.getRandomValues(new Uint32Array(6));
  const chars = Array.from(values, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]);
  return `${chars.slice(0, 3).join("")}-${chars.slice(3).join("")}`;
}
