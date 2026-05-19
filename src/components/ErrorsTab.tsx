import { useState, useEffect, useCallback } from 'react';
import type { GrammarError } from '../types';
import { supabase } from '../lib/supabase';
import { CheckCircle2, Clock } from 'lucide-react';

type FilterMode = 'all' | 'unreviewed' | 'reviewed';
type SortMode = 'newest' | 'oldest';

interface Props {
  userId: string;
  onCountChange: (n: number) => void;
  /** When set, scroll to top and highlight errors from this session */
  focusSessionId?: string;
}

export function ErrorsTab({ userId, onCountChange, focusSessionId }: Props) {
  const [errors, setErrors] = useState<GrammarError[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>('unreviewed');
  const [sort, setSort] = useState<SortMode>('newest');

  const fetchErrors = useCallback(async () => {
    const { data } = await supabase
      .from('grammar_errors')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (data) {
      setErrors(data as GrammarError[]);
      const unreviewed = (data as GrammarError[]).filter((e) => !e.reviewed).length;
      onCountChange(unreviewed);
    }
    setLoading(false);
  }, [userId, onCountChange]);

  useEffect(() => {
    fetchErrors();
  }, [fetchErrors]);

  // If arriving from a session, switch to 'all' so new errors are visible
  useEffect(() => {
    if (focusSessionId) setFilter('all');
  }, [focusSessionId]);

  async function markReviewed(id: string) {
    await supabase.from('grammar_errors').update({ reviewed: true }).eq('id', id);
    setErrors((prev) => {
      const updated = prev.map((e) => (e.id === id ? { ...e, reviewed: true } : e));
      onCountChange(updated.filter((e) => !e.reviewed).length);
      return updated;
    });
  }

  const filtered = errors
    .filter((e) => {
      if (filter === 'unreviewed') return !e.reviewed;
      if (filter === 'reviewed') return e.reviewed;
      return true;
    })
    .sort((a, b) => {
      const d = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sort === 'newest' ? -d : d;
    });

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-5 h-5 border-2 border-stone-300 border-t-[#D4883A] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex rounded-md overflow-hidden border border-stone-200 text-xs">
          {(['all', 'unreviewed', 'reviewed'] as FilterMode[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                filter === f
                  ? 'bg-[#1C1917] text-white'
                  : 'bg-white text-stone-500 hover:text-stone-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex rounded-md overflow-hidden border border-stone-200 text-xs ml-auto">
          {(['newest', 'oldest'] as SortMode[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                sort === s
                  ? 'bg-[#1C1917] text-white'
                  : 'bg-white text-stone-500 hover:text-stone-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-16 text-stone-400">
          <p className="text-4xl mb-3">✨</p>
          <p className="text-sm">
            {filter === 'unreviewed'
              ? 'No unreviewed errors — nice work!'
              : filter === 'reviewed'
              ? 'No reviewed errors yet.'
              : 'No errors collected yet. Start a practice session!'}
          </p>
        </div>
      )}

      {/* Error cards */}
      <div className="space-y-3">
        {filtered.map((err) => {
          const isNew = err.source_session_id === focusSessionId;
          return (
            <div
              key={err.id}
              className={`rounded-xl p-4 transition-opacity ${
                err.reviewed ? 'opacity-50' : ''
              } ${isNew ? 'ring-2 ring-amber-300' : ''}`}
              style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.06)', background: '#fff' }}
            >
              {/* Original → Corrected */}
              <div className="space-y-1.5 mb-3">
                <div className="flex items-start gap-2 text-sm">
                  <span className="text-red-400 mt-0.5 flex-shrink-0">❌</span>
                  <span
                    className="px-2 py-0.5 rounded bg-red-50 text-red-700 leading-snug"
                    style={{ fontFamily: 'inherit' }}
                  >
                    {err.original_text}
                  </span>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <span className="text-emerald-500 mt-0.5 flex-shrink-0">✅</span>
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 leading-snug">
                    {err.corrected_text}
                  </span>
                </div>
              </div>

              {/* Reason */}
              <p className="text-[13px] text-stone-500 mb-3 leading-relaxed">
                💡 {err.reason}
              </p>

              {/* Footer */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1 text-[11px] text-stone-400">
                    <Clock size={11} />
                    {new Date(err.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  {err.vocab_context.slice(0, 3).map((v) => (
                    <span
                      key={v}
                      className="text-[11px] px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full"
                    >
                      {v}
                    </span>
                  ))}
                  {err.vocab_context.length > 3 && (
                    <span className="text-[11px] text-stone-400">
                      +{err.vocab_context.length - 3} more
                    </span>
                  )}
                </div>
                {!err.reviewed && (
                  <button
                    onClick={() => markReviewed(err.id)}
                    className="flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-full border border-stone-200 text-stone-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors"
                  >
                    <CheckCircle2 size={12} /> Mark reviewed
                  </button>
                )}
                {err.reviewed && (
                  <span className="flex items-center gap-1 text-[12px] text-emerald-500">
                    <CheckCircle2 size={12} /> Reviewed
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
