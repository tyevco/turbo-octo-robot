// 32-bit FNV-1a over the UTF-8 bytes of a string (no TextEncoder in herdr).

/** FNV-1a 32 of `str` as an unsigned integer. */
export function fnv1a32n(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      h = Math.imul(h ^ c, 0x01000193);
      continue;
    }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // lone surrogate
    if (c < 0x800) {
      h = Math.imul(h ^ (0xc0 | (c >> 6)), 0x01000193);
    } else if (c < 0x10000) {
      h = Math.imul(h ^ (0xe0 | (c >> 12)), 0x01000193);
      h = Math.imul(h ^ (0x80 | ((c >> 6) & 63)), 0x01000193);
    } else {
      h = Math.imul(h ^ (0xf0 | (c >> 18)), 0x01000193);
      h = Math.imul(h ^ (0x80 | ((c >> 12) & 63)), 0x01000193);
      h = Math.imul(h ^ (0x80 | ((c >> 6) & 63)), 0x01000193);
    }
    h = Math.imul(h ^ (0x80 | (c & 63)), 0x01000193);
  }
  return h >>> 0;
}

/** FNV-1a 32 of `str` as 8 lower-case hex digits. */
export function fnv1a32(str) {
  return ("0000000" + fnv1a32n(str).toString(16)).slice(-8);
}
