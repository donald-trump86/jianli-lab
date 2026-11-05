import type { SVGProps } from 'react';

const paths = {
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  download: 'M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4',
  upload: 'M12 16V4m-4 4 4-4 4 4M5 16v4h14v-4',
  reset: 'M4 10a8 8 0 1 1 1 8M4 4v6h6',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  circuit: 'M4 4v16m16-16v16M4 8h5v8h6V8h5M2 4h4m12 0h4M2 20h4m12 0h4',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  shuffle: 'M3 6h3l12 12h3M3 18h3L18 6h3m-4-3 4 3-4 3m0 6 4 3-4 3',
  book: 'M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3V4Zm9 2v15',
} as const;

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
