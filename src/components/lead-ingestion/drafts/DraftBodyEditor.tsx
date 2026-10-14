'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { sanitizeEmailHtml } from '@/lib/utils/sanitizeHtml';

/**
 * The email body editor: a rich text surface with an HTML view.
 *
 * Everything pasted in is sanitized before it reaches the document, so styles
 * and scripts from Word or Gmail can't travel into an outgoing email, and the
 * read-only preview renders sanitized HTML too.
 */
export default function DraftBodyEditor({
  value,
  onChange,
  readOnly = false,
  label = 'Email body',
}: {
  value: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  label?: string;
}) {
  const [mode, setMode] = useState<'visual' | 'html'>('visual');
  const editorRef = useRef<HTMLDivElement>(null);
  const typingRef = useRef(false);

  // Only write into the DOM when the value changed elsewhere (AI refine, reload),
  // never while the user is typing: that would move the caret.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || typingRef.current) return;
    if (editor.innerHTML !== value) editor.innerHTML = value || '';
  }, [value, mode]);

  const pushChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    typingRef.current = true;
    onChange(editor.innerHTML);
    window.setTimeout(() => {
      typingRef.current = false;
    }, 120);
  };

  const format = (command: string) => {
    if (readOnly || !editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command);
    pushChange();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    const safe = html
      ? sanitizeEmailHtml(html)
      : text
          .split(/\n{2,}/)
          .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br />')}</p>`)
          .join('');
    document.execCommand('insertHTML', false, safe);
    pushChange();
  };

  if (readOnly) {
    return (
      <div
        className="email-body min-h-[160px] overflow-x-auto rounded-md border border-slate-200 bg-slate-50/70 p-4 text-sm break-words text-slate-700"
        dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(value) }}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-300 bg-white focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
        <div className="flex items-center gap-1">
          {(
            [
              { command: 'bold', label: 'Bold', className: 'font-bold' },
              { command: 'italic', label: 'Italic', className: 'italic' },
              { command: 'underline', label: 'Underline', className: 'underline' },
            ] as const
          ).map((button) => (
            <button
              key={button.command}
              type="button"
              onClick={() => format(button.command)}
              aria-label={button.label}
              title={button.label}
              disabled={mode === 'html'}
              className={cn(
                'h-7 w-7 rounded text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-40',
                button.className
              )}
            >
              {button.label[0]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-[11px] font-semibold">
          {(['visual', 'html'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              className={cn(
                'rounded px-2 py-1 transition-colors',
                mode === option
                  ? 'border border-slate-300 bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              )}
            >
              {option === 'visual' ? 'Visual' : 'HTML'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'visual' ? (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          tabIndex={0}
          onInput={pushChange}
          onBlur={() => {
            typingRef.current = false;
            pushChange();
          }}
          onPaste={handlePaste}
          className="email-body min-h-[200px] p-4 text-sm leading-relaxed break-words text-slate-800 focus:outline-none"
        />
      ) : (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} (HTML)`}
          spellCheck={false}
          className="min-h-[200px] w-full resize-y bg-slate-900 p-3 font-mono text-xs text-slate-100 focus:outline-none"
        />
      )}
    </div>
  );
}
