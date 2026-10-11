// HarmoNova URL policy — shared by the background service worker (via importScripts)
// and the content script (loaded as the first content script).
//
// Implements the remote-URL rules from docs/implementation-plan.md:
//   SEC-22 background requests carry no cookies (enforced where fetches happen)
//   SEC-23 background refuses Hacker News hosts for preview/summary fetches
//   SEC-24 only public http(s) targets on default ports; no local/private networks
//          and no exotic literal-IP spellings; redirects re-validated hop by hop.
//
// This file must stay dependency-free and side-effect-free apart from the exported
// global, so it can run in a service worker and in a page context unchanged.

(() => {
  "use strict";

  const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

  // Hostnames that always resolve to loopback or a local scope.
  const LOCAL_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback", "localhost.localdomain"]);

  // IPv4 blocks that must never be fetched. [start, end] as unsigned 32-bit values.
  const PRIVATE_V4_BLOCKS = [
    [0x00000000, 0x000000ff], // 0.0.0.0/8         "this network"
    [0x0a000000, 0x0affffff], // 10/8              private
    [0x64400000, 0x647fffff], // 100.64/10         CGNAT
    [0x7f000000, 0x7fffffff], // 127/8             loopback
    [0xa9fe0000, 0xa9feffff], // 169.254/16        link-local
    [0xac100000, 0xac1fffff], // 172.16/12         private
    [0xc0000000, 0xc000ffff], // 192.0.0/24 + TEST-NETs area
    [0xc0000200, 0xc00002ff], // 192.0.2/24        TEST-NET-1
    [0xc0a80000, 0xc0a8ffff], // 192.168/16        private
    [0xc6120000, 0xc63fffff], // 198.18/15         benchmarking
    [0xc6336400, 0xc63364ff], // 198.51.100/24     TEST-NET-2
    [0xcb007100, 0xcb0071ff], // 203.0.113/24      TEST-NET-3
    [0xe0000000, 0xefffffff], // multicast
    [0xf0000000, 0xffffffff], // reserved/broadcast
  ];

  function isPrivateIpv4Value(value) {
    if (!Number.isFinite(value)) return false;
    const n = value >>> 0;
    return PRIVATE_V4_BLOCKS.some(([start, end]) => n >= start && n <= end);
  }

  // Dotted quad parse that refuses leading zeros: browsers resolve "0177.0.0.1"
  // as octal for 127.0.0.1, so any leading-zero part is treated as forbidden.
  function dottedIpv4(host) {
    const parts = String(host).split(".");
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
      if (!/^\d{1,3}$/.test(part)) return null;
      if (part.length > 1 && part[0] === "0") return -1; // octal-ish spelling → forbidden
      const n = Number(part);
      if (n > 255) return null;
      value = value * 256 + n;
    }
    return value;
  }

  // Accepts the host as written in the URL. Returns a number when the spelling
  // (decimal, hex, octal, or dotted) denotes an IPv4 address; -1 when the spelling
  // is forbidden (leading zeros); null when it is not an IPv4 literal.
  function literalIpv4(host) {
    const raw = String(host).trim().toLowerCase();
    if (!raw || !/^[0-9a-z.]+$/.test(raw)) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(raw)) return dottedIpv4(raw);
    if (raw.includes(".")) {
      // Mixed forms: a.b (a+b), a.b.c (a.b.c). Browsers may resolve these; treat
      // any numeric mixed form as a literal IPv4 and decide via the block list.
      const parts = raw.split(".");
      if (parts.every((p) => /^0[xX][0-9a-fA-F]+$/.test(p) || /^\d+$/.test(p))) {
        if (parts.length === 2 && parts.every((p) => !/^0\d/.test(p))) {
          const [a, b] = parts.map((p) => p.startsWith("0x") ? Number(p) : Number(p));
          if (a <= 255 && b <= 65535) return a * 65536 + b;
        }
        if (parts.length === 3 && parts.every((p) => !/^0\d/.test(p))) {
          const [a, b, c] = parts.map((p) => p.startsWith("0x") ? Number(p) : Number(p));
          if (a <= 255 && b <= 255 && c <= 65535) return a * 16777216 + b * 65536 + c;
        }
      }
      // Leading-zero dotted octal spellings like "0177.0.0.1" → forbidden.
      if (parts.some((p) => /^\d+$/.test(p) && p.length > 1 && p[0] === "0")) return -1;
      return null;
    }
    if (/^0x[0-9a-f]+$/.test(raw)) return Number(raw);
    if (/^0[0-7]+$/.test(raw)) return Number.parseInt(raw, 8); // octal integer, e.g. 017700000001
    if (/^\d+$/.test(raw)) return Number(raw); // decimal integer, e.g. 2130706433
    return null;
  }

  function expandIpv6(host) {
    const raw = String(host).replace(/^\[|\]$/g, "").toLowerCase();
    if (!raw.includes(":")) return null;
    if (!/^[0-9a-f:.]+$/.test(raw)) return null;
    const halves = raw.split("::");
    if (halves.length > 2) return null;
    const parseSide = (side) => (side === "" ? [] : side.split(":").filter(Boolean));
    let groups;
    if (halves.length === 2) {
      const left = parseSide(halves[0]);
      const right = parseSide(halves[1]);
      const fill = 8 - left.length - right.length;
      if (fill < 0) return null;
      groups = [...left, ...Array(fill).fill("0"), ...right];
    } else {
      groups = parseSide(raw);
    }
    if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    return groups.map((g) => Number.parseInt(g, 16));
  }

  function isPrivateIpv6(host) {
    const groups = expandIpv6(host);
    if (!groups) return false;
    const [g0, g1] = groups;
    const allZero = groups.every((g) => g === 0);
    if (allZero) return true; // :: and ::1
    if (groups.slice(0, 6).every((g) => g === 0)) return true; // ::x IPv4-compatible / loopback family
    if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local (fe80..febf)
    if (g0 >= 0xfc00 && g0 <= 0xfdff) return true; // fc00::/7 ULA
    if (g0 === 0x2002) return true; // 6to4: embeds an IPv4 target
    if ((g0 & 0xffff) === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
    if (g0 === 0 && g1 === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
      const v4 = (groups[6] << 16) + groups[7]; // IPv4-mapped ::ffff:a.b.c.d
      return isPrivateIpv4Value(v4);
    }
    // Teredo 2001::/32 embeds obfuscated IPv4 — block conservatively.
    if (g0 === 0x2001 && g1 === 0) return true;
    return false;
  }

  function isForbiddenHost(host) {
    const raw = String(host || "").toLowerCase().replace(/\.$/, "");
    if (!raw) return true;
    if (LOCAL_HOSTNAMES.has(raw)) return true;
    if (BLOCKED_HOST_SUFFIXES.some((suffix) => raw.endsWith(suffix))) return true;
    if (raw.includes(":")) return isPrivateIpv6(raw);
    const v4 = literalIpv4(raw);
    if (v4 !== null) return v4 === -1 ? true : isPrivateIpv4Value(v4);
    return false;
  }

  function isHackerNewsHost(host) {
    const raw = String(host || "").toLowerCase();
    return raw === "news.ycombinator.com" || raw === "ycombinator.com"
      || raw.endsWith(".ycombinator.com") || raw.endsWith(".news.ycombinator.com");
  }

  // Public API.
  const HarmoNovaUrlPolicy = {
    isHackerNewsHost,

    // SEC-23 convenience: does this URL string point at Hacker News?
    isHackerNewsUrl(value) {
      try {
        return HarmoNovaUrlPolicy.isHackerNewsHost(new URL(String(value)).hostname);
      } catch {
        return false;
      }
    },

    // SEC-24: is this URL acceptable for a background fetch? No network side effects.
    isAllowedRemoteUrl(value) {
      let url;
      try {
        url = new URL(String(value));
      } catch {
        return false;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
      // Default ports only; anything else is a local-network smell.
      if (url.port && url.port !== "80" && url.port !== "443") return false;
      if (url.username || url.password) return false;
      if (isHackerNewsHost(url.hostname)) return false;
      if (isForbiddenHost(url.hostname)) return false;
      return true;
    },

    isForbiddenHost,
    literalIpv4,
    isPrivateIpv4: isPrivateIpv4Value,
    isPrivateIpv6,
  };

  if (typeof globalThis !== "undefined") {
    globalThis.HarmoNovaUrlPolicy = HarmoNovaUrlPolicy;
  }
})();