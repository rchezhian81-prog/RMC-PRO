'use client';

import { useId, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * A password box with "show while typing" and a Caps Lock warning.
 *
 * The eye button switches the field between hidden and plain text, so a long
 * password can be checked before it is sent; it is a real button, labelled for
 * screen readers, and never part of the form's submit. The Caps Lock line
 * appears only while the key is on and the field has focus, which is when the
 * mistake happens. Everything else is the ordinary Input, so the field looks
 * and behaves like every other one in the app.
 */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const { className = '', onKeyDown, onKeyUp, onBlur, ...rest } = props;
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const capsId = useId();

  function watchCaps(e: KeyboardEvent<HTMLInputElement>) {
    setCaps(typeof e.getModifierState === 'function' && e.getModifierState('CapsLock'));
  }

  return (
    <div className="mn-pw">
      <div className="mn-pw-box">
        <input
          {...rest}
          type={shown ? 'text' : 'password'}
          className={`mn-input mn-pw-input ${className}`.trim()}
          aria-describedby={[rest['aria-describedby'], caps ? capsId : undefined].filter(Boolean).join(' ') || undefined}
          onKeyDown={(e) => { watchCaps(e); onKeyDown?.(e); }}
          onKeyUp={(e) => { watchCaps(e); onKeyUp?.(e); }}
          onBlur={(e) => { setCaps(false); onBlur?.(e); }}
        />
        <button
          type="button"
          className="mn-pw-toggle"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          title={shown ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
      {caps && <span id={capsId} className="mn-pw-caps" role="status">Caps Lock is on</span>}
    </div>
  );
}
