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


  // ---------- Equity curve, in R ----------
  // Cumulative R over the sequence of trades. Plotted in R rather than dollars
  // on purpose: dollars depend on account size and would let a big position
  // disguise a bad run. The shape — how deep the dips go and how long they
  // last — is what tells you whether you could actually have sat through it.
  function equityCurve(container, curve) {
    if (!curve || curve.length < 2) { container.innerHTML = ''; return; }
    const W = 640, H = 220, padL = 8, padR = 46, padT = 14, padB = 22;
    const rs = curve.map((p) => p.r);
    const min = Math.min(0, ...rs), max = Math.max(0, ...rs);
    const sx = scale(0, curve.length - 1, padL, W - padR);
    const sy = scale(min, max, H - padB, padT);
    const pts = curve.map((p, i) => [sx(i), sy(p.r)]);

    // Shade the deepest peak-to-trough stretch — the bad patch you'd have lived through.
    let peak = -Infinity, peakI = 0, ddStart = 0, ddEnd = 0, worst = 0;
    for (let i = 0; i < curve.length; i++) {
      if (curve[i].r > peak) { peak = curve[i].r; peakI = i; }
      const dd = peak - curve[i].r;
      if (dd > worst) { worst = dd; ddStart = peakI; ddEnd = i; }
    }
    const shade = worst > 0
      ? `<rect x="${sx(ddStart).toFixed(1)}" y="${padT}" width="${(sx(ddEnd) - sx(ddStart)).toFixed(1)}"
           height="${H - padB - padT}" fill="var(--bad)" opacity="0.07" />`
      : '';

    const zero = hline(sy(0), padL, W - padR, 'var(--border)', '', W);
    const last = curve[curve.length - 1].r;
    const color = last >= 0 ? 'var(--good)' : 'var(--bad)';
    const endLabel = txt(W - padR + 4, sy(last) + 3, `${last >= 0 ? '+' : ''}${last.toFixed(1)}R`,
      { color, size: 11, weight: '700' });
    const axis =
      txt(padL, padT - 3, `${max >= 0 ? '+' : ''}${max.toFixed(1)}R`, { size: 9 }) +
      txt(padL, H - padB + 12, curve[0].d, { size: 9 }) +
      txt(W - padR, H - padB + 12, curve[curve.length - 1].d, { size: 9, anchor: 'end' }) +
      (worst > 0 ? txt((sx(ddStart) + sx(ddEnd)) / 2, H - padB - 4,
        `worst drawdown −${worst.toFixed(1)}R`, { anchor: 'middle', size: 9, color: 'var(--bad)' }) : '');

    container.innerHTML = svg(W, H, shade + zero + polyline(pts, color, { width: 2 }) + endLabel + axis);
  }

  // ---------- Distribution of results, in R ----------
  // A working trend system usually looks like a wall of small losses with a
  // thin tail of large wins. Seeing that shape before trading is what stops
  // you abandoning the system while you are standing in the wall.
  function rHistogram(container, buckets) {
    if (!buckets || !buckets.length) { container.innerHTML = ''; return; }
    const W = 640, H = 190, padL = 8, padR = 8, padT = 14, padB = 34;
    const maxC = Math.max(...buckets.map((b) => b.count), 1);
    const bw = (W - padL - padR) / buckets.length;
    const sy = scale(0, maxC, H - padB, padT);
    const bars = buckets.map((b, i) => {
      const x = padL + i * bw + bw * 0.14;
      const w = bw * 0.72;
      const y = sy(b.count);
      const h = Math.max(0, H - padB - y);
      const neg = b.label.includes('-') && !b.label.startsWith('0');
      const color = neg ? 'var(--bad)' : 'var(--good)';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"
                fill="${color}" opacity="${b.count ? 0.82 : 0.18}" rx="2" />` +
        (b.count ? txt(x + w / 2, y - 3, b.count, { anchor: 'middle', size: 10, weight: '700', color }) : '') +
        txt(x + w / 2, H - padB + 13, b.label, { anchor: 'middle', size: 8.5 });
    }).join('');
    container.innerHTML = svg(W, H, bars);
  }


  // ---------- Stability across rolling windows ----------
  // One bar per overlapping window of the development period. A system whose
  // bars are all roughly the same height had a steady edge; one carried by a
  // single tall bar had a good year, which is a different claim entirely.
  function stabilityChart(container, windows) {
    if (!windows || windows.length < 2) { container.innerHTML = ''; return; }
    const W = 640, H = 170, padL = 8, padR = 8, padT = 16, padB = 30;
    const vals = windows.map((w) => w.avgR ?? 0);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const sy = scale(lo, hi, H - padB, padT);
    const bw = (W - padL - padR) / windows.length;
    const zeroY = sy(0);
    const bars = windows.map((w, i) => {
      const v = w.avgR ?? 0;
      const x = padL + i * bw + bw * 0.18;
      const wd = bw * 0.64;
      const y = v >= 0 ? sy(v) : zeroY;
      const h = Math.max(1, Math.abs(sy(v) - zeroY));
      const color = v >= 0 ? 'var(--good)' : 'var(--bad)';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${wd.toFixed(1)}"
                height="${h.toFixed(1)}" fill="${color}" opacity="0.8" rx="2" />` +
        txt(x + wd / 2, (v >= 0 ? y - 4 : y + h + 10), `${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
          { anchor: 'middle', size: 9, weight: '700', color }) +
        txt(x + wd / 2, H - padB + 13, w.start.slice(2, 7), { anchor: 'middle', size: 8.5 });
    }).join('');
    const zero = `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}"
                    stroke="var(--border)" stroke-width="1" />`;
    container.innerHTML = svg(W, H, zero + bars +
      txt(padL, H - 4, 'each bar = a 12-month window, stepped 3 months', { size: 8.5 }));
  }

  window.charts = { rsiSparkline, priceChart, payoffChart, replayChart, equityCurve, rHistogram, stabilityChart };
})();
