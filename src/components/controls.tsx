'use client';

import { useId } from 'react';

type RangeFieldProps = {
  label: string; value: number; min: number; max: number; step?: number;
  unit?: string; className?: string; onChange: (value: number) => void;
};

export function RangeField({ label, value, min, max, step = 1, unit = '', className = '', onChange }: RangeFieldProps) {
  const id = useId();
  return <div className={`range-field ${className}`}>
    <div className="field-heading"><label htmlFor={id}>{label}</label><output htmlFor={id}>{Number(value.toFixed(3))}<span>{unit}</span></output></div>
    <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
    <div className="range-ends" aria-hidden="true"><span>{min}</span><span>{max}</span></div>
  </div>;
}
