'use client';

import { useId, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { KnnConfig, Vec2 } from '@/lib/experiments';
import { classify } from '@/lib/knn';
import { RangeField } from './controls';

const LEFT = 52, TOP = 26, SIZE = 440, UNIT = SIZE / 10;
const screen = (point: Vec2) => ({ x: LEFT + (point.x + 5) * UNIT, y: TOP + (5 - point.y) * UNIT });
const clamp = (value: number) => Math.round(Math.max(-5, Math.min(5, value)) * 100) / 100;
const metricNames = { euclidean: '欧氏距离', manhattan: '曼哈顿距离', chebyshev: '切比雪夫距离' };
const formulas = { euclidean: 'd = √[(sx·Δx)² + (sy·Δy)²]', manhattan: 'd = |sx·Δx| + |sy·Δy|', chebyshev: 'd = max(|sx·Δx|, |sy·Δy|)' };
type Target = { kind: 'query' } | { kind: 'sample'; id: string };
type Props = { config: KnnConfig; onChange: (config: KnnConfig) => void };

export function KnnExperiment({ config, onChange }: Props) {
  const plotRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ target: Target; offset: Vec2; pointerId: number } | null>(null);
  const clipId = useId();
  const result = useMemo(() => classify(config), [config]);
  const selected = new Set(result.neighbors.map(point => point.id));
  const query = screen(config.query);
  const radius = result.neighbors.at(-1)?.distance ?? 0;
  const rx = radius / config.scaleX * UNIT, ry = radius / config.scaleY * UNIT;
  // The decision field depends on samples and the metric, never on the observation point.
  const regions = useMemo(() => Array.from({ length: 28 * 28 }, (_, index) => {
    const col = index % 28, row = Math.floor(index / 28);
    return { col, row, label: classify(config, { x: -5 + (col + 0.5) * 10 / 28, y: 5 - (row + 0.5) * 10 / 28 }).label };
  }), [config.points, config.k, config.metric, config.scaleX, config.scaleY]);

  function coordinates(clientX: number, clientY: number): Vec2 | null {
    const matrix = plotRef.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: (point.x - LEFT) / UNIT - 5, y: 5 - (point.y - TOP) / UNIT };
  }
  function move(target: Target, point: Vec2) {
    const position = { x: clamp(point.x), y: clamp(point.y) };
    onChange(target.kind === 'query' ? { ...config, query: position } : { ...config, points: config.points.map(sample => sample.id === target.id ? { ...sample, ...position } : sample) });
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = coordinates(event.clientX, event.clientY);
    if (point) move(drag.target, { x: point.x - drag.offset.x, y: point.y - drag.offset.y });
  }
  function pointerStart(event: PointerEvent<SVGGElement>, target: Target, position: Vec2) {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const point = coordinates(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    dragging.current = { target, offset: { x: point.x - position.x, y: point.y - position.y }, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
  }
  function keyboardMove(event: KeyboardEvent<SVGGElement>, target: Target, point: Vec2) {
    const directions: Record<string, Vec2> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: 1 }, ArrowDown: { x: 0, y: -1 } };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.5 : 0.1;
    move(target, { x: point.x + direction.x * step, y: point.y + direction.y * step });
  }

  return <>
    <div className="quick-controls"><RangeField label="邻居数量 k" min={1} max={Math.min(15, config.points.length)} value={config.k} onChange={k => onChange({ ...config, k })} /><div className="select-field"><label htmlFor="quick-distance-metric">距离度量</label><select id="quick-distance-metric" value={config.metric} onChange={event => onChange({ ...config, metric: event.target.value as KnnConfig['metric'] })}>{Object.entries(metricNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></div></div>
    <section className="visual-card" aria-labelledby="knn-visual-title">
      <div className="visual-heading"><h2 id="knn-visual-title">距离塑造边界</h2><span className="quiet-label">{config.points.length} 个样本 · k = {config.k}</span></div>
      <div className="plot-wrap">
        <svg ref={plotRef} viewBox="0 0 544 510" className="knn-plot" role="group" aria-label="KNN 样本与决策区域，点可拖动或用方向键移动" onPointerMove={pointerMove} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }} onLostPointerCapture={() => { dragging.current = null; }}>
          <defs><clipPath id={clipId}><rect x={LEFT} y={TOP} width={SIZE} height={SIZE} /></clipPath></defs>
          <rect x={LEFT} y={TOP} width={SIZE} height={SIZE} fill="var(--surface)" />
          <g clipPath={`url(#${clipId})`}>
            {regions.map(cell => <rect key={`${cell.col}-${cell.row}`} x={LEFT + cell.col * SIZE / 28} y={TOP + cell.row * SIZE / 28} width={SIZE / 28 + 0.2} height={SIZE / 28 + 0.2} fill={cell.label === 'A' ? 'var(--class-a-soft)' : 'var(--class-b-soft)'} />)}
            {Array.from({ length: 11 }, (_, index) => <g key={index} stroke={index === 5 ? 'var(--control)' : 'var(--rule)'} strokeWidth={index === 5 ? 1.2 : 0.7}><path d={`M${LEFT + index * UNIT} ${TOP}v${SIZE}`} /><path d={`M${LEFT} ${TOP + index * UNIT}h${SIZE}`} /></g>)}
            {result.neighbors.map(point => { const end = screen(point); return <line key={point.id} x1={query.x} y1={query.y} x2={end.x} y2={end.y} stroke="var(--text)" strokeWidth="1.2" strokeDasharray="3 5" opacity="0.45" />; })}
            <g fill="none" stroke="var(--text)" strokeWidth="1.2" strokeDasharray="5 5" opacity="0.55">
              {config.metric === 'euclidean' ? <ellipse cx={query.x} cy={query.y} rx={rx} ry={ry} /> : config.metric === 'manhattan' ? <path d={`M${query.x} ${query.y - ry}L${query.x + rx} ${query.y}L${query.x} ${query.y + ry}L${query.x - rx} ${query.y}Z`} /> : <rect x={query.x - rx} y={query.y - ry} width={rx * 2} height={ry * 2} />}
            </g>
            {config.points.map(point => { const position = screen(point); const target: Target = { kind: 'sample', id: point.id }; return <g key={point.id} className="movable-point" transform={`translate(${position.x} ${position.y})`} role="button" tabIndex={0} aria-label={`${point.label} 类样本 ${point.id}，x ${point.x.toFixed(2)}，y ${point.y.toFixed(2)}，方向键移动`} onPointerDown={event => pointerStart(event, target, point)} onKeyDown={event => keyboardMove(event, target, point)}>
              <title>{`${point.label} 类 · ${point.id} · (${point.x.toFixed(2)}, ${point.y.toFixed(2)})`}</title>
              <circle r="20" fill="transparent" className="point-hit" />
              {selected.has(point.id) && <circle r="10" fill="none" stroke="var(--text)" strokeWidth="1.2" />}
              {point.label === 'A' ? <circle r="5.8" fill="var(--chart-1)" stroke="var(--surface)" strokeWidth="1.7" /> : <rect x="-5.5" y="-5.5" width="11" height="11" rx="1" fill="var(--chart-2)" stroke="var(--surface)" strokeWidth="1.7" />}
            </g>; })}
            <g className="movable-point query-point" transform={`translate(${query.x} ${query.y})`} role="button" tabIndex={0} aria-label={`观察点，x ${config.query.x.toFixed(2)}，y ${config.query.y.toFixed(2)}，方向键移动`} onPointerDown={event => pointerStart(event, { kind: 'query' }, config.query)} onKeyDown={event => keyboardMove(event, { kind: 'query' }, config.query)}>
              <circle r="24" fill="var(--surface)" opacity="0.65" /><circle r="24" fill="transparent" className="point-hit" />
              <path d="M0-10V10M-10 0H10" stroke="var(--text)" strokeWidth="3" />
              <circle r="4" fill="var(--text)" />
              <text x="15" y="-16" fill="var(--text)" fontSize="12" fontWeight="600">观察点</text>
            </g>
          </g>
          <rect x={LEFT} y={TOP} width={SIZE} height={SIZE} fill="none" stroke="var(--control)" />
          {[-5, 0, 5].map(value => <g key={value} fill="var(--muted)" fontSize="12"><text x={screen({ x: value, y: 0 }).x} y="486" textAnchor="middle">{value}</text><text x="38" y={screen({ x: 0, y: value }).y + 4} textAnchor="end">{value}</text></g>)}
          <text x="492" y="505" textAnchor="end" fill="var(--muted)" fontSize="12">特征 x</text><text x="52" y="16" fill="var(--muted)" fontSize="12">特征 y</text>
        </svg>
      </div>
      <div className="canvas-legend"><span><i className="legend-dot class-a" />A 类</span><span><i className="legend-dot class-b square" />B 类</span><span className="legend-hint">拖动点，或用方向键微调</span></div>
      <div className="classification-result" aria-live="polite"><div className={`class-result-badge class-${result.label.toLowerCase()}`}>{result.label}</div><div><strong>观察点归为 {result.label} 类</strong><p>A 类 {result.votes.A} 票 · B 类 {result.votes.B} 票</p></div><div className="vote-share"><strong>{Math.round(result.voteShare * 100)}<small>%</small></strong><span>胜出类别票数占比</span></div></div>
      <p className="figure-caption">浅色区域是 28 × 28 网格的分类示意；当前观察点按精确距离计算。票数占比不代表预测概率。</p>
    </section>
    <aside className="parameters-card" aria-labelledby="knn-parameters"><div className="section-heading"><h2 id="knn-parameters">实验参数</h2><span>变化即刻生效</span></div><div className="parameter-grid">
      <RangeField className="quick-field" label="邻居数量 k" min={1} max={Math.min(15, config.points.length)} value={config.k} onChange={k => onChange({ ...config, k })} />
      <div className="select-field quick-field"><label htmlFor="distance-metric">距离度量</label><select id="distance-metric" value={config.metric} onChange={event => onChange({ ...config, metric: event.target.value as KnnConfig['metric'] })}>{Object.entries(metricNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></div>
      <RangeField label="x 轴计算尺度" min={0.1} max={10} step={0.1} value={config.scaleX} unit="×" onChange={scaleX => onChange({ ...config, scaleX })} />
      <RangeField label="y 轴计算尺度" min={0.1} max={10} step={0.1} value={config.scaleY} unit="×" onChange={scaleY => onChange({ ...config, scaleY })} />
    </div>
    <details className="advanced-controls"><summary>精确移动观察点</summary><RangeField label="观察点 x 坐标" min={-5} max={5} step={0.01} value={config.query.x} onChange={x => onChange({ ...config, query: { ...config.query, x } })} /><RangeField label="观察点 y 坐标" min={-5} max={5} step={0.01} value={config.query.y} onChange={y => onChange({ ...config, query: { ...config.query, y } })} /></details>
    <div className="neighbor-list"><h3>参与投票的邻居</h3><table><thead><tr><th>样本</th><th>类别</th><th>距离</th></tr></thead><tbody>{result.neighbors.map(point => <tr key={point.id}><td>{point.id}</td><td><span className={`class-label class-${point.label.toLowerCase()}`}>{point.label}</span></td><td>{point.distance.toFixed(3)}</td></tr>)}</tbody></table></div>
    <details className="model-note"><summary>这个实验如何计算？</summary><p className="formula">{formulas[config.metric]}</p><p>尺度只参与距离计算，不改变图上的原始坐标。等距离按样本 ID 排序；同票按最近邻居的距离决定，再同距时 A 类优先。</p></details>
    </aside>
  </>;
}
