// Isolated-world HarmoNovaContentDom module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
  const ICONS = {
    chevron: '<path d="M7 10l5 5 5-5z"/>',
    search: '<path d="M9.5 3a6.5 6.5 0 104.08 11.56L19 20l1-1-5.44-5.42A6.5 6.5 0 009.5 3zm0 1.8a4.7 4.7 0 110 9.4 4.7 4.7 0 010-9.4z"/>',
    more: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    comment: '<path d="M4 4.5h16v12H9l-4.2 3.1.7-3.1H4v-12zm1.8 1.8v8.4h2.3l-.3 1.4 1.6-1.4h8.8V6.3H5.8z"/>',
    replyPlus: '<path d="M4 4.5h16v12H9l-4.2 3.1.7-3.1H4v-12zm1.8 1.8v8.4h2.3l-.3 1.4 1.6-1.4h8.8V6.3H5.8z"/><path d="M11 8h2v4h-2zM10 9h4v2h-4z"/>',
    up: '<path d="M12 3l6 7h-4v9h-4v-9H6l6-7z"/>',
    down: '<path d="M12 21l-6-7h4V5h4v9h4l-6 7z"/>',
    thumb: '<path d="M8.5 10.5 12 4c.9 0 1.6.7 1.6 1.6v3.2H19a2 2 0 0 1 1.9 2.5l-1.5 6A2.2 2.2 0 0 1 17.3 19H8.5V10.5Z"/><path d="M4 10.5h4.5V19H4z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<path d="M12 3.2a4 4 0 110 8 4 4 0 010-8zm0 9.8c4.4 0 7 2.2 7 5v1H5v-1c0-2.8 2.6-5 7-5z"/>',
    star: '<path d="M12 2.8l2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 16.82l-5.5 2.9 1.05-6.12L3.1 9.27l6.15-.9L12 2.8zm0 4.1l-1.55 3.14-3.47.5 2.51 2.45-.59 3.45 3.1-1.63 3.1 1.63-.59-3.45 2.51-2.45-3.47-.5L12 6.9z"/>',
    sparkle: '<path d="M12 2l1.3 4.2L17.5 7.5l-4.2 1.3L12 13l-1.3-4.2-4.2-1.3 4.2-1.3L12 2zm6 9l.8 2.7 2.7.8-2.7.8L18 18l-.8-2.7-2.7-.8 2.7-.8L18 11zM6 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/>',
    share: '<path d="M18 16a3 3 0 00-2.4 1.2L8.9 13.4a3.4 3.4 0 000-2.8l6.7-3.8A3 3 0 1014.9 5L8.2 8.8a3 3 0 100 6.4l6.7 3.8A3 3 0 1018 16z"/>',
    link: '<path d="M9.2 15.8l-1.4 1.4a3.4 3.4 0 01-4.8-4.8l3-3a3.4 3.4 0 014.8 0l.8.8-1.3 1.3-.8-.8a1.6 1.6 0 00-2.2 0l-3 3a1.6 1.6 0 002.2 2.2l1.4-1.4 1.3 1.3zm5.6-7.6l1.4-1.4a3.4 3.4 0 014.8 4.8l-3 3a3.4 3.4 0 01-4.8 0l-.8-.8 1.3-1.3.8.8a1.6 1.6 0 002.2 0l3-3a1.6 1.6 0 00-2.2-2.2l-1.4 1.4-1.3-1.3zM8.6 14.1l5.5-5.5 1.3 1.3-5.5 5.5-1.3-1.3z"/>',
    settings: '<path d="M19.4 13a7.7 7.7 0 000-2l2-1.5-2-3.4-2.4 1a7 7 0 00-1.8-1L15 3.5h-4L10.6 6a7 7 0 00-1.8 1l-2.4-1-2 3.4 2 1.5a7.7 7.7 0 000 2l-2 1.5 2 3.4 2.4-1a7 7 0 001.8 1l.4 2.5h4l.4-2.5a7 7 0 001.8-1l2.4 1 2-3.4-2-1.5zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"/>',
    refresh: '<path d="M12 20a8 8 0 1 1 5.65-13.65L20 4v7h-7l2.65-2.65A5.15 5.15 0 1 0 17.05 14h2.2A7.35 7.35 0 0 1 12 20z"/>',
    power: '<path d="M11 3h2v9h-2V3zm5.66 2.34 1.42-1.42A9 9 0 1 1 5.92 3.92l1.42 1.42A7 7 0 1 0 16.66 5.34z"/>',
    edit: '<path d="M3 17.2V21h3.8L18.5 9.3l-3.8-3.8L3 17.2zM20.7 6.1c.4-.4.4-1 0-1.4l-2.4-2.4c-.4-.4-1-.4-1.4 0l-1.9 1.9 3.8 3.8 1.9-1.9z"/>',
    trash: '<path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-.8 12H6.8L6 9z"/>',
    close: '<path d="M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5z"/>',
    external: '<path d="M13 4h7v7h-2V7.4l-7.3 7.3-1.4-1.4L16.6 6H13V4zM5 6h6v2H7v9h9v-4h2v6H5V6z"/>',
    plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/>',
    heart: '<path d="M12 20.3l-1.3-1.2C6 15 3 12.3 3 8.9 3 6.2 5.1 4.1 7.8 4.1c1.5 0 3 .7 4.2 1.9 1.2-1.2 2.7-1.9 4.2-1.9C18.9 4.1 21 6.2 21 8.9c0 3.4-3 6.1-7.7 10.2l-1.3 1.2z"/>',
    flag: '<path d="M6 3h2v18H6V3zm2 1h11l-2.5 4L19 12H8V4z"/>',
    eyeOff: '<path d="M3.3 2.5l18.2 18.2-1.4 1.4-3.5-3.5c-1.4.6-3 .9-4.6.9-5 0-9.3-3-11.5-7.5 1-2 2.4-3.7 4.1-5L1.9 3.9l1.4-1.4zM12 5c5 0 9.3 3 11.5 7-.9 1.8-2.1 3.4-3.6 4.6l-3-3A4.5 4.5 0 0010.4 7L8.9 5.5c1-.3 2-.5 3.1-.5zm0 3.5c.5 0 1 .1 1.4.3l-4.6 4.6A4.5 4.5 0 0112 8.5z"/>',
  };

  const svg = (name, className = "") => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("class", "harmonova-icon " + className);
    s.innerHTML = ICONS[name] || "";
    return s;
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const button = (iconName, label, className = "icon-button") => {
    const b = el("button", className);
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.appendChild(svg(iconName));
    return b;
  };


    return Object.freeze({get svg(){return svg;},
get el(){return el;},
get button(){return button;}});
  }
  globalThis.HarmoNovaContentDom=Object.freeze({create});
})();
