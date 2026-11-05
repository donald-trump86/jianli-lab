'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs/animation';
import { applyPlan, planSchema, type ExperimentConfig, type ExperimentPlan } from '@/lib/experiments';
import { Icon } from './icons';

type Props = { current: ExperimentConfig; onApply: (config: ExperimentConfig) => void };
type Preview = { plan: ExperimentPlan; source: 'local' | 'ai'; baseline: string };

export function AiPanel({ current, onApply }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const changed = preview !== null && preview.baseline !== JSON.stringify(current);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/experiment', { signal: controller.signal, cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => setConfigured(data.configured === true))
      .catch(() => { if (!controller.signal.aborted) setConfigured(false); });
    return () => { controller.abort(); requestRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!previewRef.current || !preview || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = animate(previewRef.current, { opacity: { from: 0.5, to: 1 }, duration: 180, ease: 'out(3)' });
    return () => { animation.revert(); };
  }, [preview]);

  function localExample(kind: 'knn' | 'bridge') {
    requestRef.current?.abort();
    setBusy(false); setError(''); setMessage('');
    const active = currentRef.current;
    const plan: ExperimentPlan = kind === 'knn' ? {
      experiment: 'knn', title: '让 x 方向的差异更重要', question: '坐标没有变化，最近邻为什么换了？',
      explanation: '把 x 轴计算尺度设为 3，y 轴保持 1。横向差异在距离中占更大比重，欧氏等距离轮廓变成椭圆。试着切换尺度，观察参与投票的邻居。',
      parameters: { query: active.kind === 'knn' ? active.query : { x: 0, y: 0 }, k: active.kind === 'knn' ? Math.min(5, active.points.length) : 5, metric: 'euclidean', scaleX: 3, scaleY: 1 },
    } : {
      experiment: 'bridge', title: '同一应变，比较全桥输出', question: '四个桥臂的变化如何共同影响输出？',
      explanation: '使用 GF = 2、5 V 激励和 500 με 正应变。全桥按左侧两臂反向变化、右侧与左侧相反的接线模型计算。切换桥路方式，比较精确输出与近似值。',
      parameters: { strainMicro: 500, gaugeFactor: 2, resistance: 120, excitation: 5, mode: 'full', activeArm: 'r1' },
    };
    setPreview({ plan, source: 'local', baseline: JSON.stringify(active) });
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !configured) return;
    const controller = new AbortController();
    requestRef.current?.abort(); requestRef.current = controller;
    const baseline = JSON.stringify(current);
    setBusy(true); setPreview(null); setError(''); setMessage('');
    try {
      const response = await fetch('/api/experiment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, current }), signal: controller.signal });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '生成失败，请稍后重试。');
      const plan = planSchema.parse(data.plan);
      applyPlan(plan, JSON.parse(baseline) as ExperimentConfig);
      setPreview({ plan, source: 'ai', baseline });
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error && reason.name !== 'ZodError' ? reason.message : '返回的实验配置无法使用，请重新生成。');
    } finally {
      if (requestRef.current === controller) { setBusy(false); requestRef.current = null; }
    }
  }

  function apply() {
    if (!preview || changed) return;
    try {
      onApply(applyPlan(preview.plan, current));
      setMessage(`已应用“${preview.plan.title}”，可以继续调整参数。`);
      setPreview(null); setError('');
    } catch { setError('这组参数与当前实验不兼容，请重新生成。'); }
  }

  return <section className="assistant-panel" aria-labelledby="assistant-title">
    <div className="assistant-intro"><div className="section-heading"><h2 id="assistant-title">从一个问题开始</h2><span>{configured === null ? '检查 AI 配置…' : configured ? 'AI 已配置' : '本地体验模式'}</span></div><p>用一句话提出实验要求，先看配置，再亲手验证。</p><div className="example-actions"><button type="button" className="text-button" onClick={() => localExample('knn')}>试试：改变距离尺度<Icon name="arrow" /></button><button type="button" className="text-button" onClick={() => localExample('bridge')}>试试：观察全桥输出<Icon name="arrow" /></button></div></div>
    <div className="assistant-work"><form onSubmit={generate}><label htmlFor="experiment-prompt">你想观察什么？</label><textarea id="experiment-prompt" value={prompt} maxLength={1000} rows={3} onChange={event => setPrompt(event.target.value)} placeholder="例如：把 x 轴尺度调到 3，看看最近邻如何变化。" /><div className="prompt-actions"><span>{busy ? '正在请求并校验完整配置…' : configured ? '发送当前实验配置与问题' : 'AI 需配置服务端密钥，可先体验上方示例'}</span>{busy ? <button type="button" className="button secondary" onClick={() => { requestRef.current?.abort(); setBusy(false); }}>取消请求</button> : <button type="submit" className="button primary" disabled={!configured || !prompt.trim()}><Icon name="spark" />生成实验</button>}</div></form>
    {preview && <div ref={previewRef} className="plan-preview"><div className="preview-heading"><span>{preview.source === 'local' ? '本地预设 · 非 AI 生成' : 'AI 配置 · 已通过结构校验'}</span><button type="button" className="icon-button" aria-label="关闭实验预览" onClick={() => setPreview(null)}><Icon name="close" /></button></div><h3>{preview.plan.title}</h3><p className="preview-question">{preview.plan.question}</p><p>{preview.plan.explanation}</p><div className="preview-parameters">{preview.plan.experiment === 'knn' ? `k = ${preview.plan.parameters.k} · ${preview.plan.parameters.metric} · x × ${preview.plan.parameters.scaleX} · y × ${preview.plan.parameters.scaleY}` : `${preview.plan.parameters.strainMicro} με · GF ${preview.plan.parameters.gaugeFactor} · ${preview.plan.parameters.excitation} V · ${preview.plan.parameters.mode}`}</div>{changed && <p className="inline-warning">当前实验已有变化，请重新选择示例或生成配置。</p>}<button type="button" className="button primary" onClick={apply} disabled={changed}>应用这组参数<Icon name="arrow" /></button></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}{message && <p className="inline-success" role="status">{message}</p>}
    </div>
  </section>;
}
