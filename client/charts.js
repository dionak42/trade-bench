'use strict';

// Hand-drawn SVG charts — no libraries. Inline SVG so it can use the app's
// CSS theme variables (stroke="var(--good)") and adapt to light/dark.
// Exposed on window.charts for app.js.
(function () {
  const money = (n) => '$' + Number(n).toFixed(2);

  // Map a data range onto a pixel range (y is inverted for screen coords).
  const scale = (dMin, dMax, pMin, pMax) => {
    const dr = (dMax - dMin) || 1;
    return (v) => pMin + ((v - dMin) / dr) * (pMax - pMin);
  };

  const polyline = (pts, color, { width = 2, dash = '' } = {}) =>
    `<polyline points="${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}"
      fill="none" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''}
      stroke-linejoin="round" stroke-linecap="round" />`;

  const hline = (y, x1, x2, color, label, W) =>
    `<line x1="${x1}" y1="${y.toFixed(1)}" x2="${x2}" y2="${y.toFixed(1)}" stroke="${color}"
      stroke-width="1.5" stroke-dasharray="4 3" opacity="0.9" />` +
    (label ? `<text x="${W - 4}" y="${(y - 3).toFixed(1)}" text-anchor="end" font-size="10"
      fill="${color}" font-weight="600">${label}</text>` : '');

  const txt = (x, y, s, { anchor = 'start', color = 'var(--muted)', size = 10, weight = '400' } = {}) =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${color}" font-weight="${weight}">${s}</text>`;

  const svg = (W, H, inner, cls = '') =>
    `<svg viewBox="0 0 ${W} ${H}" class="chart-svg ${cls}" preserveAspectRatio="none" width="100%" height="${H}">${inner}</svg>`;

  // ---------- RSI sparkline (momentum direction) ----------
  function rsiSparkline(series, direction) {
    if (!series || series.length < 2) return '';
    const W = 150, H = 40, pad = 4;
    const min = Math.min(...series), max = Math.max(...series);
    const sx = scale(0, series.length - 1, pad, W - pad);
    const sy = scale(min - 1, max + 1, H - pad, pad);
    const pts = series.map((v, i) => [sx(i), sy(v)]);
    const color = direction === 'rising' ? 'var(--good)'
      : direction === 'falling' ? 'var(--bad)' : 'var(--muted)';
    const dot = `<circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="2.5" fill="${color}" />`;
    return svg(W, H, polyline(pts, color, { width: 2 }) + dot, 'sparkline');
  }

  // ---------- Price chart with plan levels + moving averages ----------
  function priceChart(container, { series, entry, target, stop, current }) {
    if (!series || series.length < 2) { container.innerHTML = ''; return; }
    const W = 640, H = 240, padL = 6, padR = 52, padT = 12, padB = 20;
    const closes = series.map((p) => p.c);
    const levels = [entry, target, stop, current].filter((v) => Number.isFinite(v));
    const sma50 = series.map((p) => p.sma50).filter((v) => v != null);
    const sma200 = series.map((p) => p.sma200).filter((v) => v != null);
    const lo = Math.min(...closes, ...levels, ...sma200, ...sma50);
    const hi = Math.max(...closes, ...levels, ...sma200, ...sma50);
    const pad = (hi - lo) * 0.06 || 1;
    const sx = scale(0, series.length - 1, padL, W - padR);
    const sy = scale(lo - pad, hi + pad, H - padB, padT);

    const priceLine = polyline(series.map((p, i) => [sx(i), sy(p.c)]), 'var(--accent)', { width: 2 });
    const ma50 = polyline(series.map((p, i) => p.sma50 != null ? [sx(i), sy(p.sma50)] : null).filter(Boolean), 'var(--warn)', { width: 1.2 });
    const ma200 = polyline(series.map((p, i) => p.sma200 != null ? [sx(i), sy(p.sma200)] : null).filter(Boolean), '#a78bfa', { width: 1.2 });

    let lines = '';
    if (Number.isFinite(current)) lines += hline(sy(current), padL, W - padR, 'var(--muted)', 'now ' + money(current), W - padR + 48);
    if (Number.isFinite(target)) lines += hline(sy(target), padL, W - padR, 'var(--accent)', 'target ' + money(target), W - padR + 48);
    if (Number.isFinite(entry)) lines += hline(sy(entry), padL, W - padR, 'var(--good)', 'entry ' + money(entry), W - padR + 48);
    if (Number.isFinite(stop)) lines += hline(sy(stop), padL, W - padR, 'var(--bad)', 'stop ' + money(stop), W - padR + 48);

    const xLabels =
      txt(padL, H - 5, series[0].d) +
      txt(W - padR, H - 5, series[series.length - 1].d, { anchor: 'end' });

    const legend =
      txt(padL + 2, padT, '● price', { color: 'var(--accent)', size: 9, weight: '600' }) +
      txt(padL + 50, padT, '● 50d', { color: 'var(--warn)', size: 9, weight: '600' }) +
      txt(padL + 90, padT, '● 200d', { color: '#a78bfa', size: 9, weight: '600' });

    container.innerHTML = svg(W, H, ma200 + ma50 + priceLine + lines + xLabels + legend);
  }

  // ---------- Options payoff diagram (P&L at expiration) ----------
  function payoffChart(container, { kind, strike, premium, current, contracts }) {
    if (![strike, premium, current, contracts].every(Number.isFinite) || contracts < 1) {
      container.innerHTML = ''; return;
    }
    const sh = contracts * 100;
    // P&L at expiration as a function of stock price S.
    const pnl = (S) => kind === 'csp'
      ? (premium - Math.max(0, strike - S)) * sh
      : ((Math.min(S, strike) - current) + premium) * sh; // covered call
    const breakeven = kind === 'csp' ? strike - premium : current - premium;

    const anchor = kind === 'csp' ? strike : current;
    const loS = Math.min(anchor, breakeven) * 0.82;
    const hiS = Math.max(anchor, strike, current) * 1.18;
    const N = 80;
    const xs = Array.from({ length: N + 1 }, (_, i) => loS + (hiS - loS) * (i / N));
    const ys = xs.map(pnl);

    const W = 640, H = 240, padL = 46, padR = 12, padT = 14, padB = 24;
    const yLo = Math.min(...ys, 0), yHi = Math.max(...ys, 0);
    const yPad = (yHi - yLo) * 0.08 || 1;
    const sx = scale(loS, hiS, padL, W - padR);
    const sy = scale(yLo - yPad, yHi + yPad, H - padB, padT);
    const zeroY = sy(0);

    // Split the payoff into profit (green) and loss (red) polylines by sign.
    const pts = xs.map((S, i) => [sx(S), sy(ys[i])]);
    const zeroLine = `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" stroke="var(--border)" stroke-width="1" />`;
    const payoff = polyline(pts, 'var(--text)', { width: 2 });
    // Shade profit region.
    const areaTop = pts.map((p, i) => ys[i] >= 0 ? p : [p[0], zeroY]);
    const profitArea = `<polygon points="${padL},${zeroY.toFixed(1)} ${areaTop.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} ${(W - padR)},${zeroY.toFixed(1)}" fill="var(--good)" opacity="0.10" />`;

    const vmark = (S, color, label) => Number.isFinite(S) && S >= loS && S <= hiS
      ? `<line x1="${sx(S).toFixed(1)}" y1="${padT}" x2="${sx(S).toFixed(1)}" y2="${H - padB}" stroke="${color}" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.8" />` +
        txt(sx(S), H - 6, label, { anchor: 'middle', color, size: 9, weight: '600' })
      : '';

    const yAxis =
      txt(padL - 4, sy(yHi) + 3, '$' + Math.round(yHi), { anchor: 'end', size: 9 }) +
      txt(padL - 4, zeroY + 3, '$0', { anchor: 'end', size: 9 }) +
      (yLo < 0 ? txt(padL - 4, sy(yLo) + 3, '-$' + Math.abs(Math.round(yLo)), { anchor: 'end', size: 9 }) : '');

    container.innerHTML = svg(W, H,
      profitArea + zeroLine + payoff +
      vmark(current, 'var(--muted)', 'now') +
      vmark(strike, 'var(--accent)', 'strike') +
      vmark(breakeven, 'var(--warn)', 'B/E') +
      yAxis);
  }

  // ---------- Replay path ----------
  function replayChart(container, r) {
    if (!r.path || r.path.length < 2) { container.innerHTML = ''; return; }
    const W = 640, H = 220, padL = 6, padR = 52, padT = 12, padB = 20;
    const closes = r.path.map((p) => p.c);
    const levels = [r.entry, r.target, r.stop].filter(Number.isFinite);
    const lo = Math.min(...closes, ...levels);
    const hi = Math.max(...closes, ...levels);
    const pad = (hi - lo) * 0.06 || 1;
    const sx = scale(0, r.path.length - 1, padL, W - padR);
    const sy = scale(lo - pad, hi + pad, H - padB, padT);

    const line = polyline(r.path.map((p, i) => [sx(i), sy(p.c)]), 'var(--accent)', { width: 2 });
    let lines = '';
    lines += hline(sy(r.target), padL, W - padR, 'var(--accent)', 'target', W - padR + 48);
    lines += hline(sy(r.entry), padL, W - padR, 'var(--good)', 'entry', W - padR + 48);
    lines += hline(sy(r.stop), padL, W - padR, 'var(--bad)', 'stop', W - padR + 48);

    const startDot = `<circle cx="${sx(0).toFixed(1)}" cy="${sy(r.path[0].c).toFixed(1)}" r="4" fill="var(--good)" />`;
    const exitColor = r.outcome === 'target' ? 'var(--good)' : r.outcome === 'stopped' ? 'var(--bad)' : 'var(--muted)';
    const li = r.path.length - 1;
    const endDot = `<circle cx="${sx(li).toFixed(1)}" cy="${sy(r.path[li].c).toFixed(1)}" r="4" fill="${exitColor}" />`;
    const xLabels = txt(padL, H - 5, r.entryDate) + txt(W - padR, H - 5, r.exitDate, { anchor: 'end' });

    container.innerHTML = svg(W, H, lines + line + startDot + endDot + xLabels);
  }

  window.charts = { rsiSparkline, priceChart, payoffChart, replayChart };
})();
