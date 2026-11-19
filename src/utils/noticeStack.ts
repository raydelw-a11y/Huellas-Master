import { useEffect, useRef, useState } from 'react';

export interface NoticeItem {
  id: number;
  text: string;
  at: number;
  key: string;
}

/**
 * Turns a single "latest notice" string into a stack: every new notice is added under the previous
 * ones and stays for `ttlMs`. A notice with the same shape as one already showing (same text once the
 * numbers are ignored, e.g. a progress counter) updates that entry instead of adding a new line.
 */
export function useNoticeStack(
  latest: string,
  ttlMs = 30000,
  options: { max?: number; isSticky?: (text: string) => boolean } = {}
): { items: NoticeItem[]; dismiss: (id: number) => void } {
  const [items, setItems] = useState<NoticeItem[]>([]);
  const seqRef = useRef(0);
  const max = options.max ?? 6;
  const isStickyRef = useRef(options.isSticky);
  isStickyRef.current = options.isSticky;

  useEffect(() => {
    const text = String(latest || '').trim();
    if (!text) return;
    const key = text.replace(/\d+(?:[.,:]\d+)*/g, '#').slice(0, 80);
    setItems((prev) => {
      const now = Date.now();
      const idx = prev.findIndex((it) => it.key === key);
      if (idx >= 0) {
        if (prev[idx].text === text) return prev.map((it, i) => (i === idx ? { ...it, at: now } : it));
        return prev.map((it, i) => (i === idx ? { ...it, text, at: now } : it));
      }
      const next = [...prev, { id: ++seqRef.current, text, at: now, key }];
      return next.length > max ? next.slice(next.length - max) : next;
    });
  }, [latest, max]);

  useEffect(() => {
    if (items.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setItems((prev) => {
        const kept = prev.filter((it) => isStickyRef.current?.(it.text) || now - it.at < ttlMs);
        return kept.length === prev.length ? prev : kept;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [items.length, ttlMs]);

  return { items, dismiss: (id: number) => setItems((prev) => prev.filter((it) => it.id !== id)) };
}
