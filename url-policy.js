// Shared privileged-URL policy. This validates URL spellings, not DNS answers.
// P09 restricts worker requests to fixed providers; browser DNS cannot be bound
// to an address by this validator alone.
(() => {
  "use strict";
  const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];
  const LOCAL_NAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback", "localhost.localdomain"]);
  // IANA special-purpose blocks, with 192.0.0.9 and .10 excluded as global.
  const NON_PUBLIC_V4 = [
    [0x00000000, 0x00ffffff], [0x0a000000, 0x0affffff],
    [0x64400000, 0x647fffff], [0x7f000000, 0x7fffffff],
    [0xa9fe0000, 0xa9feffff], [0xac100000, 0xac1fffff],
    [0xc0000000, 0xc0000008], [0xc000000b, 0xc00000ff],
    [0xc0000200, 0xc00002ff], [0xc0586300, 0xc05863ff],
    [0xc0a80000, 0xc0a8ffff], [0xc6120000, 0xc613ffff],
    [0xc6336400, 0xc63364ff], [0xcb007100, 0xcb0071ff],
    [0xe0000000, 0xefffffff], [0xf0000000, 0xffffffff],
  ];
  const isPrivateIpv4 = value => Number.isSafeInteger(value) && value >= 0
    && value <= 0xffffffff && NON_PUBLIC_V4.some(([a, b]) => value >= a && value <= b);
  function canonicalIpv4(host) {
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return null;
    const octets = host.split(".").map(Number);
    if (octets.some(n => n > 255)) return null;
    return octets.reduce((n, x) => n * 256 + x, 0);
  }
  // For callers requiring diagnostics only. All literal IPv6 addresses are
  // forbidden for external previews, including public and transition forms.
  function isPrivateIpv6(host) {
    const h = String(host).replace(/^\[|\]$/g, "").toLowerCase();
    return h === "::" || h === "::1" || /^(ff|fe[89ab]|fc|fd)/.test(h)
      || /^(2002:|2001:0:|64:ff9b:)/.test(h) || h.includes("ffff:");
  }
  function normalizedHostname(value) {
    if (typeof value !== "string" || !value) return null;
    const trailingDots = (value.match(/\.+$/) || [""])[0].length;
    if (trailingDots > 1) return null;
    return (trailingDots === 1 ? value.slice(0, -1) : value).toLowerCase();
  }
  function isHackerNewsHost(host) {
    const h = normalizedHostname(host);
    return Boolean(h && (h === "ycombinator.com" || h.endsWith(".ycombinator.com")));
  }
  function isForbiddenHost(host) {
    const h = normalizedHostname(host);
    if (!h || LOCAL_NAMES.has(h) || LOCAL_SUFFIXES.some(s => h.endsWith(s))) return true;
    // WHATWG URL has already canonicalized decimal, octal, hexadecimal and
    // shortened IPv4 spellings. Never independently parse mixed IPv4 forms.
    if (h.includes(":") || h.includes("[") || h.includes("]") || canonicalIpv4(h) !== null) return true;
    if (!h.includes(".") || h.length > 253) return true;
    return h.split(".").some(label => label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  }
  function parseRemoteUrl(value) {
    // Only absolute HTTP(S) strings are accepted. Reject WHATWG's permissive
    // relative, backslash, whitespace and control-character interpretations.
    if (typeof value !== "string" || value.length > 4096
      || !/^https?:\/\//i.test(value) || value !== value.trim()
      || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
    let url;
    try { url = new URL(value); } catch { return null; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    // WHATWG normalizes only the correct default for each scheme to "".
    // Thus http://host:443 and https://host:80 are rejected.
    if (url.port) return null;
    const host = normalizedHostname(url.hostname);
    if (!host || isHackerNewsHost(host) || isForbiddenHost(host)) return null;
    if (host !== url.hostname) url.hostname = host; // remove exactly one DNS root dot
    return url;
  }
  const HarmoNovaUrlPolicy = {
    isHackerNewsHost,
    isHackerNewsUrl(value) {
      try { return typeof value === "string" && isHackerNewsHost(new URL(value).hostname); }
      catch { return false; }
    },
    isForbiddenHost,
    isPrivateIpv4,
    isPrivateIpv6,
    isAllowedRemoteUrl(value) { return Boolean(parseRemoteUrl(value)); },
    canonicalRemoteUrl(value) { return parseRemoteUrl(value)?.href || null; },
  };
  globalThis.HarmoNovaUrlPolicy = HarmoNovaUrlPolicy;
})();
