// Local-only opt-in viewport impressions. Never calls Hacker News's hide endpoint.
(() => {
  'use strict';
  function create({list, settings, seen, searchActive, mark, filter}) {
    const DWELL_MS = 650;
    const timers = new Map();
    let armed = false;
    let observed = new WeakSet();
    const enabled = () => settings().hideSeen === true && !searchActive();
    const cancel = card => {
      clearTimeout(timers.get(card));
      timers.delete(card);
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const card = entry.target;
        cancel(card);
        if (!armed || !enabled() || !list.contains(card)) continue;
        const id = Number(card.dataset.storyId);
        if (!Number.isSafeInteger(id) || id <= 0 || card.hidden) continue;
        if (entry.intersectionRatio >= 0.6 && !seen().has(id)) {
          timers.set(card, setTimeout(() => {
            timers.delete(card);
            if (!armed || !enabled() || !list.contains(card) || card.hidden || seen().has(id)) return;
            // Do not remove the card while the reader is still looking at it.
            card.dataset.seenActive = '1';
            Promise.resolve(mark(id)).catch(() => {});
          }, DWELL_MS));
        } else if (!entry.isIntersecting && card.dataset.seenActive === '1') {
          delete card.dataset.seenActive;
          filter();
        }
      }
    }, {root:list, threshold:[0,0.6]});
    function observeCards() {
      if (!armed || !enabled()) return;
      for (const card of list.querySelectorAll('.story-card[data-story-id]')) {
        if (observed.has(card)) continue;
        observed.add(card);
        observer.observe(card);
      }
    }
    const mutation = new MutationObserver(records => {
      // Search/list switches replace story nodes. Require fresh scrolling on
      // the new surface; adding another feed batch does not reset progress.
      if (records.some(record => [...record.removedNodes].some(node =>
        node.nodeType === 1 && (node.matches?.('.story-card') || node.querySelector?.('.story-card'))))) reset();
      observeCards();
    });
    mutation.observe(list, {childList:true});
    function onScroll(event) {
      if (!event.isTrusted || !enabled()) return;
      if (!armed) armed = true;
      observeCards();
    }
    function reset() {
      armed = false;
      observer.disconnect();
      for (const card of timers.keys()) cancel(card);
      observed = new WeakSet();
    }
    function disconnect() { reset(); mutation.disconnect(); }
    return Object.freeze({onScroll,reset,disconnect});
  }
  globalThis.HarmoNovaContentSeenStories = Object.freeze({create});
})();
