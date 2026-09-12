'use strict';

// Instant custom tooltips for any element with a [data-tip] attribute.
// Replaces native title= (which has a ~1s delay). Text is trusted app copy,
// and we use textContent, so there's no injection surface.
(function () {
  const tip = document.createElement('div');
  tip.className = 'app-tooltip hidden';
  document.body.appendChild(tip);

  let current = null;

  function show(el) {
    const text = el.getAttribute('data-tip');
    if (!text) return;
    current = el;
    tip.textContent = text;
    tip.classList.remove('hidden');
    position(el);
  }

  function hide() {
    current = null;
    tip.classList.add('hidden');
  }

  function position(el) {
    const r = el.getBoundingClientRect();
    // Measure after content is set.
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const gap = 8;
    // Prefer above, centered; flip below if no room.
    let top = r.top - th - gap;
    let placedBelow = false;
    if (top < 8) { top = r.bottom + gap; placedBelow = true; }
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    tip.style.top = `${top + window.scrollY}px`;
    tip.style.left = `${left + window.scrollX}px`;
    tip.dataset.placement = placedBelow ? 'below' : 'above';
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && el !== current) show(el);
  });
  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && el === current && !el.contains(e.relatedTarget)) hide();
  });
  // Hide on scroll/resize so a stale tooltip never floats over the page.
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
})();
