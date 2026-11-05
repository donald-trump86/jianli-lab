import type { KnnConfig, Metric, Sample, Vec2 } from './experiments';

export type Neighbor = Sample & { distance: number };
export type KnnResult = {
  label: 'A' | 'B'; neighbors: Neighbor[];
  votes: { A: number; B: number }; voteShare: number;
};

export function distance(a: Vec2, b: Vec2, metric: Metric, scaleX: number, scaleY: number): number {
  const dx = Math.abs((a.x - b.x) * scaleX);
  const dy = Math.abs((a.y - b.y) * scaleY);
  if (metric === 'manhattan') return dx + dy;
  if (metric === 'chebyshev') return Math.max(dx, dy);
  return Math.hypot(dx, dy);
}

export function classify(config: KnnConfig, query: Vec2 = config.query): KnnResult {
  const neighbors: Neighbor[] = config.points
    .map((point) => ({
      ...point,
      distance: distance(point, query, config.metric, config.scaleX, config.scaleY),
    }))
    .sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, config.k);
  const votes = { A: 0, B: 0 };
  const nearest = { A: Infinity, B: Infinity };
  for (const neighbor of neighbors) {
    votes[neighbor.label] += 1;
    nearest[neighbor.label] = Math.min(nearest[neighbor.label], neighbor.distance);
  }
  const label = votes.A === votes.B
    ? (nearest.A <= nearest.B ? 'A' : 'B')
    : (votes.A > votes.B ? 'A' : 'B');
  return { label, neighbors, votes, voteShare: votes[label] / neighbors.length };
}
