'use client';

import { Search, X } from 'lucide-react';
import type { ChangeEvent } from 'react';

/** Search surface: leading icon, input, and a clear button when non-empty. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  ariaLabel = 'Search',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="mn-search">
      <Search size={16} aria-hidden />
      <input
        type="search"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" className="mn-search-clear" aria-label="Clear search" onClick={() => onChange('')}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}
