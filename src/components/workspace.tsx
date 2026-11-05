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
  const tabBarRef = useRef<HTMLElement>(null);
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
    <header className="topbar">
      <a href="/" className="wordmark" aria-label="见理实验台"><svg width="32" height="32" viewBox="0 0 29 29" fill="none" aria-hidden="true"><path d="M6 5h17v13H6zM10 22l-4 3M17 18v7h6" stroke="currentColor" strokeWidth="2" /><circle cx="14.5" cy="11.5" r="2.5" fill="currentColor" /></svg><span>见理<small>Jianli Lab</small></span></a>
      <nav ref={tabBarRef} className="experiment-tabs" aria-label="选择实验"><button type="button" aria-pressed={current.kind === 'knn'} onClick={() => select('knn')}><Icon name="grid" />距离与分类</button><button type="button" aria-pressed={current.kind === 'bridge'} onClick={() => select('bridge')}><Icon name="circuit" />应变与电桥</button><span ref={indicatorRef} className="tab-indicator" aria-hidden="true" /></nav>
      <div className="workspace-actions"><button type="button" className="button secondary" onClick={() => inputRef.current?.click()}><Icon name="upload" /><span>导入快照</span></button><button type="button" className="button primary" onClick={download}><Icon name="download" /><span>保存快照</span></button><input ref={inputRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={upload} aria-label="选择实验快照文件" tabIndex={-1} /></div>
    </header>
    <main className="work-sheet" id="experiment-workspace">
      <div className="workspace-heading"><div><h1>{info.title}</h1><p>{info.description}</p></div><div className="experiment-utilities">{current.kind === 'knn' && <button type="button" className="text-button new-samples" aria-label="换一组样本" title="换一组样本" onClick={() => { seedRef.current += 1; change({ ...current, points: makeKnn(seedRef.current).points }); setNotice('已生成一组新的示例样本，其余参数保持不变。'); setError(''); }}><Icon name="shuffle" />换一组样本</button>}<button type="button" className="text-button" onClick={reset} aria-label="重置当前实验"><Icon name="reset" />重置</button></div></div>
      {(notice || error) && <div className={error ? 'workspace-message error' : 'workspace-message'} role={error ? 'alert' : 'status'}><Icon name={error ? 'close' : 'check'} /><span>{error || notice}</span><button type="button" className="icon-button" onClick={() => { setNotice(''); setError(''); }} aria-label="关闭提示"><Icon name="close" /></button></div>}
      <div className={`experiment-grid experiment-${current.kind}`}>
        {current.kind === 'knn' ? <KnnExperiment config={current} onChange={change} /> : <BridgeExperiment config={current} onChange={change} />}
        <AiPanel current={current} onApply={change} />
      </div>
      <footer className="workspace-footer"><span>见理 · 让原理，在手边发生</span><span>教学示例 · 本地计算<a href="https://github.com/donald-trump86/jianli-lab" target="_blank" rel="noreferrer">GitHub<Icon name="arrow" /></a></span></footer>
    </main>
  </div>;
}
