'use client';

import { useMemo } from 'react';
import type { BridgeConfig } from '@/lib/experiments';
import { calculateBridge } from '@/lib/bridge';
import { RangeField } from './controls';

const modeNames = { quarter: '四分之一桥', half: '半桥', full: '全桥' };
const millivolts = (volts: number) => `${volts > 0.000000005 ? '+' : ''}${(volts * 1000).toFixed(4)}`;
type Props = { config: BridgeConfig; onChange: (config: BridgeConfig) => void };

export function BridgeExperiment({ config, onChange }: Props) {
  const result = useMemo(() => calculateBridge(config), [config]);
  const maxOutput = Math.max(Math.abs(calculateBridge({ ...config, strainMicro: -3000 }).outputVoltage), Math.abs(calculateBridge({ ...config, strainMicro: 3000 }).outputVoltage)) * 1000;
  const curvePoint = (strain: number) => ({ x: 72 + (strain + 3000) / 6000 * 412, y: 72 - calculateBridge({ ...config, strainMicro: strain }).outputVoltage * 1000 / maxOutput * 48 });
  const curve = Array.from({ length: 121 }, (_, index) => { const point = curvePoint(-3000 + index * 50); return `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`; }).join(' ');
  const marker = curvePoint(config.strainMicro);
  const armLabels = { r1: 'R₁', r2: 'R₂', r3: 'R₃', r4: 'R₄' };

  return <>
    <div className="quick-controls"><RangeField label="应变 ε" min={-3000} max={3000} step={10} value={config.strainMicro} unit="με" onChange={strainMicro => onChange({ ...config, strainMicro })} /><div className="select-field"><label htmlFor="quick-bridge-mode">桥路方式</label><select id="quick-bridge-mode" value={config.mode} onChange={event => onChange({ ...config, mode: event.target.value as BridgeConfig['mode'] })}>{Object.entries(modeNames).map(([mode, name]) => <option key={mode} value={mode}>{name}</option>)}</select></div></div>
    <section className="visual-card bridge-visual" aria-labelledby="bridge-visual-title">
      <div className="visual-heading"><h2 id="bridge-visual-title">把形变变成信号</h2><span className="quiet-label">{modeNames[config.mode]}</span></div>
      <div className="bridge-body"><div className="circuit-stage"><svg viewBox="0 0 544 374" className="bridge-diagram" role="img" aria-label={`惠斯通电桥，输出为左分压减右分压。当前输出 ${millivolts(result.outputVoltage)} 毫伏`}>
        <g fill="none" stroke="var(--control)" strokeWidth="2"><path d="M166 72V38H352V72M166 132V208M352 132V208M166 268V306H352V268M260 38V20M260 306V324" /><path d="M166 38H66V136M66 198V306H166" /><path d="M166 170H232M290 170H352" strokeDasharray="4 4" /></g>
        <g stroke="var(--text)" strokeWidth="2"><path d="M49 153H83M56 166H76M49 179H83M56 192H76" /></g>
        <text x="22" y="170" textAnchor="middle" className="diagram-label">{config.excitation} V</text>
        <text x="66" y="286" textAnchor="middle" className="diagram-note">激励电源</text>
        {(Object.entries(result.resistors) as [keyof typeof result.resistors, number][]).map(([arm, resistance]) => {
          const x = arm === 'r1' || arm === 'r2' ? 144 : 330;
          const y = arm === 'r1' || arm === 'r3' ? 72 : 208;
          const active = arm === config.activeArm || (config.mode !== 'quarter' && (arm === 'r1' || arm === 'r2')) || config.mode === 'full';
          const delta = resistance - config.resistance;
          return <g key={arm}><rect x={x} y={y} width="44" height="60" rx="4" fill={active ? 'var(--class-a-soft)' : 'var(--raised)'} stroke={active ? 'var(--chart-1)' : 'var(--control)'} strokeWidth="1.6" /><text x={x + 22} y={y + 26} textAnchor="middle" className="diagram-resistor">{armLabels[arm]}</text><text x={x + 22} y={y + 44} textAnchor="middle" className="diagram-note">{delta > 0 ? '+ΔR' : delta < 0 ? '−ΔR' : 'R'}</text><text x={x + (x < 200 ? -12 : 56)} y={y + 32} textAnchor={x < 200 ? 'end' : 'start'} className="diagram-value">{resistance.toFixed(3)} Ω</text></g>;
        })}
        <circle cx="166" cy="170" r="5" fill="var(--chart-1)" /><circle cx="352" cy="170" r="5" fill="var(--chart-2)" />
        <circle cx="261" cy="170" r="27" fill="var(--surface)" stroke="var(--text)" strokeWidth="1.5" /><text x="261" y="176" textAnchor="middle" className="diagram-resistor">Vₒ</text>
        <text x="216" y="157" className="diagram-label">+</text><text x="296" y="157" className="diagram-label">−</text>
        <text x="261" y="354" textAnchor="middle" className="diagram-note">输出极性：左分压 − 右分压</text>
      </svg></div>
      <aside className="bridge-insight" aria-label="电桥实时读数"><div className="output-reading" aria-live="polite"><span>输出电压</span><strong>{millivolts(result.outputVoltage)}<small>mV</small></strong><p>左侧分压 − 右侧分压</p></div><div className="bridge-reading"><div><span><i className="legend-dot class-a" />左侧分压</span><strong>{result.leftVoltage.toFixed(6)}<small>V</small></strong></div><div><span><i className="legend-dot class-b" />右侧分压</span><strong>{result.rightVoltage.toFixed(6)}<small>V</small></strong></div></div><div className="measurement-notes"><h3>与近似值对照</h3><dl><div><dt>小信号近似</dt><dd>{millivolts(result.approxVoltage)} mV</dd></div><div><dt>正应变臂 ΔR</dt><dd>{result.deltaResistance.toFixed(4)} Ω</dd></div></dl><p>拖动应变，比较精确分压与一阶近似。</p></div></aside>
      <div className="curve-block"><div className="curve-heading"><h3>应变与输出</h3><span>圆点对应当前应变</span></div>
      <svg viewBox="0 0 544 158" className="transfer-curve" role="img" aria-label="应变与电桥输出的精确计算曲线，横轴为微应变，纵轴为毫伏">
        <path d="M72 20V128H484M72 72H484M278 20V128" fill="none" stroke="var(--border)" strokeWidth="1" />
        <path d={curve} fill="none" stroke="var(--chart-1)" strokeWidth="2.5" />
        <path d={`M${marker.x} ${marker.y}V128`} stroke="var(--control)" strokeDasharray="3 4" />
        <circle cx={marker.x} cy={marker.y} r="6" fill="var(--chart-1)" stroke="var(--surface)" strokeWidth="2" />
        <g fill="var(--muted)" fontSize="12"><text x="72" y="148">−3000</text><text x="278" y="148" textAnchor="middle">0</text><text x="484" y="148" textAnchor="end">+3000 με</text><text x="60" y="28" textAnchor="end">{Number(maxOutput.toPrecision(3))}</text><text x="60" y="76" textAnchor="end">0</text><text x="60" y="124" textAnchor="end">−{Number(maxOutput.toPrecision(3))}</text><text x="72" y="16">mV</text></g>
      </svg>
      </div></div><p className="figure-caption">曲线使用精确分压式。{config.activeArm === 'r1' ? 'R₁' : 'R₂'} 为正应变臂；其余受力方向按所选模型约定。</p>
    </section>
    <aside className="parameters-card" aria-labelledby="bridge-parameters"><div className="section-heading"><h2 id="bridge-parameters">实验参数</h2><span>拉动应变，观察零点</span></div><div className="parameter-grid">
      <RangeField className="quick-field" label="应变 ε" min={-3000} max={3000} step={10} value={config.strainMicro} unit="με" onChange={strainMicro => onChange({ ...config, strainMicro })} />
      <div className="select-field quick-field"><label htmlFor="bridge-mode">桥路方式</label><select id="bridge-mode" value={config.mode} onChange={event => onChange({ ...config, mode: event.target.value as BridgeConfig['mode'] })}>{Object.entries(modeNames).map(([mode, name]) => <option key={mode} value={mode}>{name}</option>)}</select></div>
      <RangeField label="灵敏系数 GF" min={1} max={4} step={0.1} value={config.gaugeFactor} onChange={gaugeFactor => onChange({ ...config, gaugeFactor })} />
      <RangeField label="激励电压" min={1} max={12} step={0.1} value={config.excitation} unit="V" onChange={excitation => onChange({ ...config, excitation })} />
    </div>
    <details className="advanced-controls"><summary>电阻与接线</summary><RangeField label="初始电阻 R" min={50} max={1000} step={10} value={config.resistance} unit="Ω" onChange={resistance => onChange({ ...config, resistance })} /><div className="select-field"><label htmlFor="bridge-arm">正应变臂</label><select id="bridge-arm" value={config.activeArm} onChange={event => onChange({ ...config, activeArm: event.target.value as BridgeConfig['activeArm'] })}><option value="r1">R₁ · 左上</option><option value="r2">R₂ · 左下</option></select></div></details>
    <details className="model-note"><summary>接线与模型假设</summary><p>Vₒ = Vex · [R₂/(R₁+R₂) − R₄/(R₃+R₄)]</p><p>ΔR/R = GF · ε。半桥的左侧两臂等量反向变化，全桥右侧两臂采用与左侧相反的变化。这是特定受力接线模型；仅凭“半桥”“全桥”名称不能推出任意实物的灵敏度或温度补偿效果。</p></details>
    </aside>
  </>;
}
