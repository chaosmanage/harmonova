// Isolated-world HarmoNovaContentSanitize module. Explicit dependencies and a restricted
// model facade preserve ownership; no HN tokens or worker credentials enter it.
(() => {
  'use strict';
  function create(dependencies,model) {
  const normalizeQuotedParagraphs = (target) => {
    const stripQuoteMarkers = (quote) => {
      const walker = document.createTreeWalker(quote, dependencies.NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        node.textContent = (node.textContent || "").replace(/(^|\n)(\s*)>\s?/g, "$1$2");
      }
    };

    target.querySelectorAll("blockquote").forEach((quote) => {
      quote.classList.add("harmonova-quote");
      stripQuoteMarkers(quote);
    });

    target.querySelectorAll("p").forEach((paragraph) => {
      const text = paragraph.textContent || "";
      if (!text.trimStart().startsWith(">")) return;
      const quote = document.createElement("blockquote");
      quote.className = "harmonova-quote";
      while (paragraph.firstChild) quote.appendChild(paragraph.firstChild);
      stripQuoteMarkers(quote);
      paragraph.replaceWith(quote);
    });

    for (const node of [...target.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent || "";
      if (!text.trimStart().startsWith(">")) continue;
      const quote = document.createElement("blockquote");
      quote.className = "harmonova-quote";
      quote.textContent = text.replace(/(^|\n)(\s*)>\s?/g, "$1$2");
      node.replaceWith(quote);
    }
  };

  const appendSanitizedHtml = (target, html) => {
    if (!html) return;
    html = String(html).slice(0,32768);
    const parsed = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html");
    const allowed = new Set(["P", "A", "PRE", "CODE", "I", "EM", "B", "STRONG", "BR", "BLOCKQUOTE"]);
    let nodes = 0;
    const copy = (source, parent, depth = 0) => {
      if (depth > 64 || nodes >= 5000) return;
      for (const child of source.childNodes) {
        if (++nodes > 5000) return;
        if (child.nodeType === Node.TEXT_NODE) {
          parent.appendChild(document.createTextNode(child.textContent || ""));
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (!allowed.has(child.tagName)) {
          copy(child, parent, depth + 1);
          continue;
        }
        const out = document.createElement(child.tagName.toLowerCase());
        if (child.tagName === "A") {
          const href = dependencies.linksUI.safeHref(child.getAttribute("href") || "");
          if (!href) { copy(child, parent, depth + 1); continue; }
          out.href = href;
          out.target = "_blank";
          out.rel = "noopener noreferrer";
        }
        copy(child, out, depth + 1);
        parent.appendChild(out);
      }
    };
    copy(parsed.body, target);
    normalizeQuotedParagraphs(target);
  };



    return Object.freeze({get appendSanitizedHtml(){return appendSanitizedHtml;}});
  }
  globalThis.HarmoNovaContentSanitize=Object.freeze({create});
})();
