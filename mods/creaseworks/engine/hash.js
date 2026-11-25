// 32-bit FNV-1a over the UTF-8 bytes of a string (no TextEncoder in herdr).

/**
 * FNV-1a 32 of `str` as an unsigned integer. A save hashes hundreds of KiB of
 * almost pure ASCII, so ASCII runs take a tight inner loop (about a quarter
 * faster in QuickJS than one branchy loop; same result).
 */
export function fnv1a32n(str) {
  const imul = Math.imul;
  const s = String(str);
  const n = s.length;
  let h = 0x811c9dc5;
  let i = 0;
  while (i < n) {
    let c = s.charCodeAt(i++);
    while (c < 0x80) {
      h = imul(h ^ c, 0x01000193);
      if (i >= n) return h >>> 0;
      c = s.charCodeAt(i++);
    }
    if (c >= 0xd800 && c <= 0xdbff && i < n) {
      const d = s.charCodeAt(i);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // lone surrogate
    if (c < 0x800) {
      h = imul(h ^ (0xc0 | (c >> 6)), 0x01000193);
    } else if (c < 0x10000) {
      h = imul(h ^ (0xe0 | (c >> 12)), 0x01000193);
      h = imul(h ^ (0x80 | ((c >> 6) & 63)), 0x01000193);
    } else {
      h = imul(h ^ (0xf0 | (c >> 18)), 0x01000193);
      h = imul(h ^ (0x80 | ((c >> 12) & 63)), 0x01000193);
      h = imul(h ^ (0x80 | ((c >> 6) & 63)), 0x01000193);
    }
    h = imul(h ^ (0x80 | (c & 63)), 0x01000193);
  }
  return h >>> 0;
}

/** FNV-1a 32 of `str` as 8 lower-case hex digits. */
export function fnv1a32(str) {
  return ("0000000" + fnv1a32n(str).toString(16)).slice(-8);
}
