'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

/**
 * Light/dark toggle. Light is the default (long-hour ops readability); the choice
 * persists in localStorage and is applied by setting `data-theme` on <html>.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const saved = localStorage.getItem('mn-theme');
    const t = saved === 'dark' ? 'dark' : 'light';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  function toggle() {
    const t = theme === 'light' ? 'dark' : 'light';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('mn-theme', t);
  }

  return (
    <button className="mn-iconbtn" onClick={toggle} aria-label="Toggle light/dark theme" title="Toggle theme">
      {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
