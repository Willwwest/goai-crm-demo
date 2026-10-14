// Chart kit for the Insights page, drawn with Apache ECharts (canvas renderer).
// Conventions (from the dataviz method): thin bars with 4px rounded data ends
// and 2px surface-colored gaps between stacked segments, hairline grid, a
// legend for 2+ series, totals labeled at the bar end, a tooltip on every mark
// that lists every series, and a table view for every chart.
import { init, format, registerMap } from '../vendor/echarts/echarts.esm.min.js?v=ae938a762063';
import { html, useState, useEffect, useRef } from './ui.js?v=ae938a762063';

const fmt = (n) => Number(n ?? 0).toLocaleString();
const esc = (s) => format.encodeHTML(String(s ?? ''));

// Resolves the brand tokens (brand.css) for the current color scheme.
function theme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    resolve: (color) => (color?.startsWith('var(') ? v(color.slice(4, -1).trim()) : color),
    font: v('--font') || 'system-ui, sans-serif',
    ink: v('--ink'), muted: v('--muted'), faint: v('--faint'), surface: v('--surface'), surface2: v('--surface-2'),
    bg: v('--bg'), line: v('--line'), lineStrong: v('--line-strong'),
    grid: v('--viz-grid'), axis: v('--viz-axis'), accent: v('--viz-accent'),
    hover: `${v('--brand-accent')}14`,
  };
}

// Tooltip body: value first, then the series name, keyed by a short line in the series color.
function tipHtml(title, rows) {
  return `<div class="viz-tip-title">${esc(title)}</div>${rows.map((r) => `<div class="viz-tip-row">${
    r.color ? `<span class="viz-key-line" style="background:${r.color}"></span>` : ''
  }<strong>${esc(r.value)}</strong><span class="muted">${esc(r.label)}</span></div>`).join('')}`;
}

function baseOption(t, series) {
  return {
    animationDuration: 300,
    animationDurationUpdate: 200,
    aria: { enabled: true },
    textStyle: { fontFamily: t.font, color: t.ink },
    legend: series.length > 1 ? {
      top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 14,
      textStyle: { color: t.muted, fontSize: 12 }, data: series.map((s) => s.label),
    } : { show: false },
    tooltip: {
      trigger: 'axis', confine: true, axisPointer: { type: 'shadow', shadowStyle: { color: t.hover } },
      backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, padding: [8, 10],
      textStyle: { color: t.ink, fontSize: 12 }, extraCssText: 'box-shadow: var(--shadow); border-radius: 8px;',
    },
  };
}

// Mounts one ECharts instance; rebuilds the option when `signature` or the color scheme changes.
export function EChart({ build, signature, height, onClick, label, onReady }) {
  const el = useRef(null);
  const chart = useRef(null);
  const [scheme, setScheme] = useState(0);
  useEffect(() => {
    chart.current = init(el.current, null, { renderer: 'canvas' });
    onReady?.(chart.current);
    const resize = new ResizeObserver(() => chart.current?.resize());
    resize.observe(el.current);
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => setScheme((n) => n + 1);
    media.addEventListener('change', onScheme);
    return () => {
      resize.disconnect();
      media.removeEventListener('change', onScheme);
      chart.current.dispose();
      chart.current = null;
    };
  }, []);
  useEffect(() => { chart.current?.setOption(build(theme()), true); }, [signature, scheme]);
  useEffect(() => {
    const c = chart.current;
    c.off('click');
    if (onClick) c.on('click', onClick);
  }, [onClick]);
  return html`<div ref=${el} class="viz-echart" style=${`height:${height}px`} aria-label=${label} />`;
}

// ---- Containers --------------------------------------------------------------------

// Card with a title and a Chart/Table toggle. `table` is { columns, rows }.
export function ChartCard({ title, subtitle, table, children, empty }) {
  const [asTable, setAsTable] = useState(false);
  return html`<section class="card viz-card">
    <div class="head">
      <div class="grow"><h2>${title}</h2>${subtitle && html`<div class="small muted">${subtitle}</div>`}</div>
      ${table && !empty && html`<button class="btn small ghost" onClick=${() => setAsTable(!asTable)} aria-pressed=${asTable}>${asTable ? 'Chart' : 'Table'}</button>`}
    </div>
    <div class="body">
      ${empty ? html`<div class="empty">${empty}</div>` : asTable ? html`<${DataTable} ...${table} />` : children}
    </div>
  </section>`;
}

export function DataTable({ columns, rows }) {
  return html`<div class="table-wrap"><table class="data viz-table">
    <thead><tr>${columns.map((c, i) => html`<th class=${i ? 'num' : ''}>${c}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => html`<tr>${r.map((v, i) => html`<td class=${i ? 'num' : ''}>${typeof v === 'number' ? fmt(v) : v}</td>`)}</tr>`)}</tbody>
  </table></div>`;
}

// ---- Figures (plain HTML: a number is not a chart) ---------------------------------------

export function StatTile({ label, value, sub, status, children, href }) {
  const icon = { critical: '!', serious: '!', good: '✓', warning: '!' }[status];
  const body = html`
    <div class="label">${label}</div>
    <div class="value">${value}</div>
    ${status && html`<div class=${`viz-status ${status}`}><span class="viz-status-icon" aria-hidden="true">${icon}</span>${{ critical: 'Needs action', serious: 'Needs attention', good: 'On track', warning: 'Watch' }[status]}</div>`}
    ${sub && html`<div class="small muted">${sub}</div>`}
    ${children}`;
  return href
    ? html`<a class="card kpi viz-tile" href=${href} style="color:inherit;text-decoration:none">${body}</a>`
    : html`<div class="card kpi viz-tile">${body}</div>`;
}

export function Meter({ value, max, label }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return html`<div class="viz-meter" role="meter" aria-valuemin="0" aria-valuemax=${max} aria-valuenow=${value} aria-label=${label}>
    <div class="viz-meter-fill" style=${`width:${pct}%`} />
  </div>`;
}

// ---- Horizontal stacked bars ----------------------------------------------------------

const rowName = (r) => r.title ?? (typeof r.label === 'string' ? r.label : String(r.key));
const sum = (values, series) => series.reduce((n, s) => n + (values[s.key] ?? 0), 0);
// Zero segments are '-' (no mark), so they draw no border stub at the baseline.
// Index of the last non-zero series in each row/column, which gets the rounded data end.
const lastFilled = (items, series) => items.map((it) => series.reduce((last, s, i) => ((it.values[s.key] ?? 0) > 0 ? i : last), -1));

// rows: [{ key, label or title, values: { [seriesKey]: n } }]; series: [{ key, label, color }].
// One series -> no legend. onPick(row) makes bars and their labels clickable.
export function BarRows({ rows, series, onPick, selected, valueText, max }) {
  const totals = rows.map((r) => sum(r.values, series));
  const names = rows.map(rowName);
  const ends = lastFilled(rows, series);
  const selectedName = rows.find((r) => r.key === selected) ? rowName(rows.find((r) => r.key === selected)) : null;
  const legend = series.length > 1;
  const endLabels = rows.map((r, i) => (valueText ? valueText(r, totals[i]) : fmt(totals[i])));
  // Room at the right for the longest end label, so it is never clipped.
  const right = Math.max(...endLabels.map((l) => l.length), 1) * 7 + 14;
  const build = (t) => ({
    ...baseOption(t, series),
    grid: { left: 4, right, top: legend ? 34 : 6, bottom: 6, containLabel: true },
    xAxis: { type: 'value', max: max || undefined, show: false },
    yAxis: {
      type: 'category', data: names, inverse: true, triggerEvent: !!onPick,
      axisTick: { show: false }, axisLine: { lineStyle: { color: t.axis } },
      axisLabel: {
        color: t.ink, fontSize: 13, width: 170, overflow: 'truncate', margin: 12,
        formatter: (name) => (name === selectedName ? `{sel|${name.replace(/[{}|]/g, '')}}` : name.replace(/[{}|]/g, '')),
        rich: { sel: { fontWeight: 'bold', color: t.accent, fontSize: 13 } },
      },
    },
    tooltip: {
      ...baseOption(t, series).tooltip,
      formatter: (items) => {
        const i = items[0].dataIndex;
        return tipHtml(names[i], series.length > 1
          ? [{ label: 'Total', value: fmt(totals[i]) }, ...series.map((s) => ({ label: s.label, value: fmt(rows[i].values[s.key] ?? 0), color: t.resolve(s.color) }))]
          : [{ label: series[0].label, value: valueText ? valueText(rows[i], totals[i]) : fmt(totals[i]) }]);
      },
    },
    series: [
      ...series.map((s, si) => ({
        name: s.label, type: 'bar', stack: 'total', barMaxWidth: 14, cursor: onPick ? 'pointer' : 'default',
        itemStyle: { color: t.resolve(s.color), borderColor: t.surface, borderWidth: 1 },
        emphasis: { disabled: true },
        data: rows.map((r, ri) => ({ value: (r.values[s.key] ?? 0) || '-', itemStyle: ends[ri] === si ? { borderRadius: [0, 4, 4, 0] } : undefined })),
      })),
      {
        // Zero-width end cap that carries the total label at the bar tip.
        name: '__total', type: 'bar', stack: 'total', silent: true, tooltip: { show: false },
        itemStyle: { color: 'transparent' },
        label: { show: true, position: 'right', color: t.muted, fontSize: 12, formatter: (p) => endLabels[p.dataIndex] },
        data: rows.map(() => 0),
      },
    ],
  });
  const onClick = onPick && ((p) => {
    if (p.componentType === 'series' && p.seriesName !== '__total') onPick(rows[p.dataIndex]);
    else if (p.componentType === 'yAxis') { const i = names.indexOf(p.value); if (i >= 0) onPick(rows[i]); }
  });
  const signature = JSON.stringify([names, rows.map((r) => r.values), series.map((s) => [s.key, s.color]), selectedName, max]);
  return html`<${EChart} build=${build} signature=${signature} onClick=${onClick} height=${rows.length * 30 + (legend ? 40 : 12)} label=${series.map((s) => s.label).join(', ')} />`;
}

// ---- Vertical stacked columns -------------------------------------------------------------

// columns: [{ key, label, values }]. The first series sits on the baseline.
export function Columns({ columns, series, height = 220 }) {
  const totals = columns.map((c) => sum(c.values, series));
  const ends = lastFilled(columns, series);
  const build = (t) => ({
    ...baseOption(t, series),
    grid: { left: 4, right: 8, top: series.length > 1 ? 40 : 12, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category', data: columns.map((c) => c.label), axisTick: { show: false },
      axisLine: { lineStyle: { color: t.axis } }, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: 'value', minInterval: 1, splitNumber: 3,
      splitLine: { lineStyle: { color: t.grid, width: 1, type: 'solid' } },
      axisLabel: { color: t.muted, fontSize: 11, formatter: (n) => fmt(n) },
    },
    tooltip: {
      ...baseOption(t, series).tooltip,
      formatter: (items) => {
        const i = items[0].dataIndex;
        return tipHtml(columns[i].label, [{ label: 'Total', value: fmt(totals[i]) },
          ...series.map((s) => ({ label: s.label, value: fmt(columns[i].values[s.key] ?? 0), color: t.resolve(s.color) }))]);
      },
    },
    series: series.map((s, si) => ({
      name: s.label, type: 'bar', stack: 'total', barMaxWidth: 24,
      itemStyle: { color: t.resolve(s.color), borderColor: t.surface, borderWidth: 1 },
      emphasis: { disabled: true },
      data: columns.map((c, ci) => ({ value: (c.values[s.key] ?? 0) || '-', itemStyle: ends[ci] === si ? { borderRadius: [4, 4, 0, 0] } : undefined })),
    })),
  });
  const signature = JSON.stringify([columns.map((c) => [c.label, c.values]), series.map((s) => [s.key, s.color])]);
  return html`<${EChart} build=${build} signature=${signature} height=${height + (series.length > 1 ? 28 : 0)} label=${series.map((s) => s.label).join(', ')} />`;
}

// ---- Geographic bubble map --------------------------------------------------------------

const registeredMaps = new Set();

// geo: { map (GeoJSON FeatureCollection), roads: [{ name, coords }] } from public/geo.
// bubbles: [{ key, name, lon, lat, score, tip: [{ label, value }] }] sized by score.
// pins: [{ id, name, lon, lat, series, tip }] exact locations, one series per tier group.
// home: { center: [lon, lat], zoom } is the starting and reset view.
export function GeoBubbleMap({ mapName, geo, bubbles, pins = [], pinSeries = [], selected, onSelect, onPin, home, height = 540, labelCount = 8 }) {
  if (!registeredMaps.has(mapName)) {
    registerMap(mapName, geo.map);
    registeredMaps.add(mapName);
  }
  const chart = useRef(null);
  const view = useRef({ center: home.center, zoom: home.zoom });
  const maxScore = Math.max(1, ...bubbles.map((b) => b.score));
  const labeled = new Set([...bubbles].sort((a, b) => b.score - a.score).slice(0, labelCount).map((b) => b.key));
  if (selected) labeled.add(selected);
  // One label per freeway, at the midpoint of its longest segment.
  const roadLabels = Object.values(geo.roads.reduce((m, r) => {
    if (!m[r.name] || r.coords.length > m[r.name].coords.length) m[r.name] = r;
    return m;
  }, {})).map((r) => ({ name: r.name, value: r.coords[Math.floor(r.coords.length / 2)] }));
  const usedPins = pinSeries.filter((s) => pins.some((p) => p.series === s.key));

  const build = (t) => ({
    animationDurationUpdate: 200,
    aria: { enabled: true },
    textStyle: { fontFamily: t.font, color: t.ink },
    tooltip: {
      trigger: 'item', confine: true, backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, padding: [8, 10],
      textStyle: { color: t.ink, fontSize: 12 }, extraCssText: 'box-shadow: var(--shadow); border-radius: 8px;',
    },
    legend: usedPins.length > 1 ? { bottom: 8, left: 8, icon: 'circle', itemWidth: 10, itemHeight: 10, textStyle: { color: t.muted, fontSize: 12 }, data: usedPins.map((s) => s.label) } : { show: false },
    geo: {
      map: mapName, roam: true, scaleLimit: { min: 0.8, max: 24 }, aspectScale: 0.84,
      center: view.current.center, zoom: view.current.zoom, silent: true,
      itemStyle: { areaColor: t.surface2, borderColor: t.lineStrong, borderWidth: 0.6 },
      regions: geo.map.features.filter((f) => f.properties.kind === 'county').map((f) => ({
        name: f.properties.name, itemStyle: { areaColor: t.surface, borderColor: t.faint, borderWidth: 1.4 },
      })),
    },
    series: [
      {
        type: 'lines', coordinateSystem: 'geo', polyline: true, silent: true, z: 2,
        lineStyle: { color: t.faint, width: 1.4, opacity: 0.85 },
        data: geo.roads.map((r) => ({ name: r.name, coords: r.coords })),
      },
      {
        type: 'scatter', coordinateSystem: 'geo', silent: true, z: 3, symbolSize: 0,
        label: { show: true, formatter: '{b}', color: t.faint, fontSize: 10, fontWeight: 600, textBorderColor: t.surface, textBorderWidth: 2 },
        labelLayout: { hideOverlap: true },
        data: roadLabels,
      },
      {
        name: 'Cities', type: 'scatter', coordinateSystem: 'geo', z: 5, cursor: 'pointer',
        symbolSize: (v) => 10 + 40 * Math.sqrt(v[2] / maxScore),
        itemStyle: { color: t.accent, opacity: 0.72, borderColor: t.surface, borderWidth: 2 },
        emphasis: { scale: 1.08, itemStyle: { opacity: 0.92 } },
        label: { position: 'right', distance: 6, formatter: '{b}', color: t.ink, fontSize: 12, fontWeight: 600, textBorderColor: t.surface, textBorderWidth: 3 },
        labelLayout: { hideOverlap: true },
        tooltip: { formatter: (p) => tipHtml(bubbles[p.dataIndex].name, bubbles[p.dataIndex].tip) },
        data: bubbles.map((b) => ({
          name: b.name, value: [b.lon, b.lat, b.score],
          label: { show: labeled.has(b.key) },
          itemStyle: b.key === selected ? { borderColor: t.ink, borderWidth: 2.5, opacity: 0.9 } : undefined,
        })),
      },
      ...usedPins.map((s) => ({
        name: s.label, type: 'scatter', coordinateSystem: 'geo', z: 6, cursor: 'pointer', symbolSize: 9,
        itemStyle: { color: t.resolve(s.color), borderColor: t.surface, borderWidth: 2 },
        tooltip: { formatter: (p) => tipHtml(p.data.name, p.data.tip) },
        data: pins.filter((p) => p.series === s.key).map((p) => ({ name: p.name, value: [p.lon, p.lat], id: p.id, tip: p.tip })),
      })),
    ],
  });

  const onReady = (c) => {
    chart.current = c;
    // Keep the reader's pan and zoom when the data or selection changes.
    c.on('georoam', () => {
      const g = c.getOption().geo?.[0];
      if (g) view.current = { center: g.center, zoom: g.zoom };
    });
  };
  const zoomBy = (factor) => {
    const c = chart.current;
    if (!c) return;
    const zoom = Math.min(24, Math.max(0.8, view.current.zoom * factor));
    view.current = { ...view.current, zoom };
    c.setOption({ geo: { zoom, center: view.current.center } });
  };
  const reset = () => {
    view.current = { center: home.center, zoom: home.zoom };
    chart.current?.setOption({ geo: { zoom: home.zoom, center: home.center } });
  };
  const onClick = (p) => {
    if (p.seriesName === 'Cities') onSelect?.(bubbles[p.dataIndex].key);
    else if (p.data?.id) onPin?.(p.data.id);
  };
  const signature = JSON.stringify([bubbles.map((b) => [b.key, b.score]), selected, pins.map((p) => [p.id, p.series]), maxScore]);
  return html`<div class="viz-map">
    <${EChart} build=${build} signature=${signature} height=${height} onClick=${onClick} onReady=${onReady} label="Map of target accounts by city" />
    <div class="viz-map-zoom">
      <button class="btn icon small" onClick=${() => zoomBy(1.5)} aria-label="Zoom in">+</button>
      <button class="btn icon small" onClick=${() => zoomBy(1 / 1.5)} aria-label="Zoom out">−</button>
      <button class="btn small" onClick=${reset} aria-label="Reset view">Reset</button>
    </div>
  </div>`;
}
