'use client';

import { useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { animate } from 'animejs/animation';
import { spring } from 'animejs/easings';
import { makeBridge, makeKnn, type ExperimentConfig } from '@/lib/experiments';
import { parseSnapshot, serializeSnapshot } from '@/lib/snapshot';
import { AiPanel } from './ai-panel';
import { BridgeExperiment } from './bridge-experiment';
import { Icon } from './icons';
import { KnnExperiment } from './knn-experiment';

const descriptions = {
  knn: { title: '距离与分类', description: '移动一个点，看“最近”如何改变判断。', name: 'KNN 与距离度量' },
  bridge: { title: '应变与电桥', description: '把微小的电阻变化，转成可见的输出。', name: '应变电桥' },
};

export function Workspace() {
  const [current, setCurrent] = useState<ExperimentConfig>(() => makeKnn());
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const initialTab = useRef(true);
  const seedRef = useRef(20261105);
  const cached = useRef<{ knn: ExperimentConfig; bridge: ExperimentConfig }>({ knn: current, bridge: makeBridge() });
  const info = descriptions[current.kind];

  useLayoutEffect(() => {
    const tab = tabBarRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    const indicator = indicatorRef.current;
    if (!tab || !indicator) return;
    const target = () => tab.offsetLeft + tab.offsetWidth / 2 - 16;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animation: ReturnType<typeof animate> | undefined;
    const settle = () => { animation?.pause(); indicator.style.transform = `translateX(${target()}px)`; };
    if (initialTab.current || motion.matches) {
      settle(); initialTab.current = false;
    } else {
      animation = animate(indicator, { x: target(), ease: spring({ stiffness: 400, damping: 40 }), duration: 300 });
    }
    window.addEventListener('resize', settle);
    motion.addEventListener('change', settle);
    return () => { animation?.pause(); window.removeEventListener('resize', settle); motion.removeEventListener('change', settle); };
  }, [current.kind]);

  function change(config: ExperimentConfig) {
    cached.current[config.kind] = config;
    setCurrent(config);
  }
  function select(kind: ExperimentConfig['kind']) {
    if (kind === current.kind) return;
    cached.current[current.kind] = current;
    change(cached.current[kind]); setNotice(''); setError('');
  }
  function reset() {
    change(current.kind === 'knn' ? makeKnn() : makeBridge());
    setNotice('已恢复这个实验的初始参数。'); setError('');
  }
  function download() {
    try {
      const blob = new Blob([serializeSnapshot(current)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `jianli-${current.kind}-snapshot.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('已导出实验快照，包含当前全部输入参数。'); setError('');
    } catch { setError('快照导出失败，请减少样本信息后重试。'); }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 65536) throw new Error('快照文件不能超过 64 KiB。');
      const config = parseSnapshot(await file.text());
      change(config); setNotice(`已载入“${descriptions[config.kind].title}”快照。`); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '快照格式不正确，请重新选择。'); setNotice(''); }
  }

  return <div className="app-shell" data-ui>
    <aside className="sidebar"><a href="/" className="wordmark" aria-label="见理实验台"><svg width="29" height="29" viewBox="0 0 29 29" fill="none" aria-hidden="true"><path d="M6 5h17v13H6zM10 22l-4 3M17 18v7h6" stroke="currentColor" strokeWidth="2" /><circle cx="14.5" cy="11.5" r="2.5" fill="currentColor" /></svg><span>见理<small>Jianli Lab</small></span></a>
      <div className="sidebar-section"><p>实验室</p><nav aria-label="实验导航"><button type="button" className={current.kind === 'knn' ? 'nav-item selected' : 'nav-item'} onClick={() => select('knn')} aria-pressed={current.kind === 'knn'}><Icon name="grid" /><span>距离与分类<small>KNN · 特征空间</small></span></button><button type="button" className={current.kind === 'bridge' ? 'nav-item selected' : 'nav-item'} onClick={() => select('bridge')} aria-pressed={current.kind === 'bridge'}><Icon name="circuit" /><span>应变与电桥<small>传感器 · 电阻测量</small></span></button></nav></div>
      <div className="sidebar-note"><Icon name="book" /><h2>让原理，在手边发生</h2><p>拖动、比较，再问一个为什么。每一组参数，都能保存为自己的实验。</p></div><div className="sidebar-footer"><span>计算在浏览器本地完成</span><a href="https://github.com/donald-trump86/jianli-lab" target="_blank" rel="noreferrer">查看 GitHub<Icon name="arrow" /></a></div>
    </aside>
    <header className="topbar"><span className="mobile-wordmark">见理</span><span className="breadcrumb">实验室<span>/</span>{info.name}</span><span className="topbar-note">把原理变成实验</span></header>
    <main className="work-sheet" id="experiment-workspace"><div className="workspace-heading"><div><h1>{info.title}</h1><p>{info.description}</p></div><div className="workspace-actions"><button type="button" className="icon-button" onClick={reset} aria-label="重置当前实验" title="重置当前实验"><Icon name="reset" /></button><button type="button" className="button secondary" onClick={() => inputRef.current?.click()}><Icon name="upload" /><span>导入快照</span></button><button type="button" className="button primary" onClick={download}><Icon name="download" /><span>保存快照</span></button><input ref={inputRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={upload} aria-label="选择实验快照文件" tabIndex={-1} /></div></div>
      <div className="experiment-toolbar"><div ref={tabBarRef} className="experiment-tabs" aria-label="选择实验"><button type="button" aria-pressed={current.kind === 'knn'} onClick={() => select('knn')}>距离与分类</button><button type="button" aria-pressed={current.kind === 'bridge'} onClick={() => select('bridge')}>应变与电桥</button><span ref={indicatorRef} className="tab-indicator" aria-hidden="true" /></div>{current.kind === 'knn' && <button type="button" className="text-button new-samples" onClick={() => { seedRef.current += 1; change({ ...current, points: makeKnn(seedRef.current).points }); setNotice('已生成一组新的示例样本，其余参数保持不变。'); setError(''); }}><Icon name="shuffle" />换一组样本</button>}</div>
      {(notice || error) && <div className={error ? 'workspace-message error' : 'workspace-message'} role={error ? 'alert' : 'status'}><Icon name={error ? 'close' : 'check'} /><span>{error || notice}</span><button type="button" className="icon-button" onClick={() => { setNotice(''); setError(''); }} aria-label="关闭提示"><Icon name="close" /></button></div>}
      <div className="experiment-grid">{current.kind === 'knn' ? <KnnExperiment config={current} onChange={change} /> : <BridgeExperiment config={current} onChange={change} />}</div>
      <AiPanel current={current} onApply={change} />
      <footer className="workspace-footer"><span>见理 · 每一次改变，都有迹可循</span><span>教学模型 · 数值由本地内核计算</span></footer>
    </main>
  </div>;
}
