'use client';

import { useId } from 'react';
import { chargeBasisLabel } from '@rmc/shared';
import { Field, Input, Select } from './ui/Field';

/**
 * A charge on a priced line: the amount beside the basis it is charged on.
 * Transport is per m³, per trip or a lump sum; pump per m³, per job or per
 * hour; waiting per m³ or per hour. Defined at module scope so the input
 * keeps focus while the page re-renders on every keystroke.
 */
export function ChargeField({
  label,
  amount,
  basis,
  bases,
  onAmount,
  onBasis,
}: {
  label: string;
  amount: string;
  basis: string;
  bases: readonly string[];
  onAmount: (v: string) => void;
  onBasis: (v: string) => void;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <div className="mn-cb-field">
        <Input id={id} type="number" step="any" inputMode="decimal" min={0} value={amount} onChange={(e) => onAmount(e.target.value)} />
        <Select value={basis} onChange={(e) => onBasis(e.target.value)} aria-label={`${label} basis`}>
          {bases.map((b) => (
            <option key={b} value={b}>{chargeBasisLabel(b)}</option>
          ))}
        </Select>
      </div>
    </Field>
  );
}
