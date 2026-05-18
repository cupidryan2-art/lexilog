import { useState, useRef } from 'react';
import type { VocabEntry } from '../types';
import { Sparkles, RefreshCw, X } from 'lucide-react';

import { getApiKey, DEEPSEEK_URL } from '../lib/apiKey';

const SYSTEM_PROMPT = `You are a professional English lexicographer and language teacher.
Given a word, collocation, or sentence pattern, return ONLY a JSON object
with no extra text, no markdown, no backticks. The JSON must follow this schema exactly:

{
  "category": "word" | "collocation" | "sentence_pattern",
  "term": "<the original input, normalized>",
  "pronunciation_ipa": "<IPA string, e.g. /ˈsɪlvər ˈlaɪnɪŋ/>",
  "english_definition": "<clear, natural English definition, 1-2 sentences>",
  "chinese_translation": "<accurate Chinese translation with usage note if needed>",
  "example_sentences": [
    "<natural example sentence 1>",
    "<natural example sentence 2>"
  ],
  "source": ""
}

Infer the category automatically:
- Single word or phrasal verb → "word"
- Fixed expression, idiom, or collocation → "collocation"
- A grammatical frame with blanks (e.g. "not only...but also") → "sentence_pattern"`;

type GeneratedFields = Omit<VocabEntry, 'id' | 'date_added' | 'starred' | 'review_count'>;

interface Props {
  onAdded: (data: GeneratedFields) => void;
}

export function QuickAdd({ onAdded }: Props) {
  const [term, setTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryTerm, setRetryTerm] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function generate(inputTerm: string) {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          max_tokens: 1000,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: inputTerm },
          ],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: { message?: string } }).error?.message ?? `API error ${res.status}`
        );
      }

      const data = await res.json() as { choices: { message: { content: string } }[] };
      const text = data.choices[0]?.message?.content ?? '';

      // Strip accidental markdown fences
      const jsonText = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(jsonText);

      onAdded({
        term: parsed.term || inputTerm,
        category: parsed.category || 'word',
        english_definition: parsed.english_definition || '',
        chinese_translation: parsed.chinese_translation || '',
        example_sentences: Array.isArray(parsed.example_sentences) ? parsed.example_sentences : [],
        pronunciation_ipa: parsed.pronunciation_ipa || '',
        source: parsed.source || '',
      });

      setTerm('');
      setRetryTerm(null);
      inputRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error. Check your API key.');
      setRetryTerm(inputTerm);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim() || loading) return;
    generate(term.trim());
  }

  return (
    <div className="mb-7">
      <form onSubmit={handleSubmit}>
        <div
          className={`flex items-center bg-white transition-all duration-150 ${
            loading
              ? 'border-amber-300 bg-amber-50/30'
              : 'border-stone-200 focus-within:border-[#D97706] focus-within:shadow-[0_0_0_3px_rgba(212,139,58,0.15)]'
          }`}
          style={{ borderWidth: '1.5px', borderStyle: 'solid', borderRadius: '14px' }}
        >
          <div className="pl-4 text-[#D48B3A] flex-shrink-0">
            <Sparkles size={16} className={loading ? 'animate-pulse' : ''} />
          </div>
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => { setTerm(e.target.value); setError(null); }}
            disabled={loading}
            placeholder="Enter a word, phrase, or sentence pattern..."
            className="flex-1 px-3 bg-transparent text-[#1C1917] text-sm placeholder:text-stone-400 focus:outline-none disabled:opacity-60 min-w-0"
            style={{ height: '52px' }}
          />
          {term && !loading && (
            <button
              type="button"
              onClick={() => { setTerm(''); setError(null); inputRef.current?.focus(); }}
              className="p-2 text-stone-300 hover:text-stone-500 transition-colors"
              tabIndex={-1}
            >
              <X size={14} />
            </button>
          )}
          <button
            type="submit"
            disabled={!term.trim() || loading}
            className="mr-1.5 px-5 bg-[#D97706] text-white text-sm font-semibold hover:bg-amber-700 transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderRadius: '10px', height: '38px' }}
          >
            {loading ? 'Generating…' : 'Add'}
          </button>
        </div>
      </form>

      {/* Shimmer skeleton while loading */}
      {loading && <SkeletonCard />}

      {/* Error with retry */}
      {error && !loading && (
        <div className="mt-3 flex items-start justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-sm">
          <p className="text-sm text-red-700 leading-snug">{error}</p>
          {retryTerm && (
            <button
              onClick={() => generate(retryTerm)}
              className="flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:text-red-900 transition-colors flex-shrink-0"
            >
              <RefreshCw size={12} /> Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="mt-3 bg-white border border-stone-200 rounded-sm px-5 py-4 overflow-hidden relative">
      {/* Shimmer sweep */}
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/70 to-transparent" />
      <div className="flex items-center gap-2 mb-3">
        <div className="h-4 w-24 bg-stone-200 rounded-sm" />
      </div>
      <div className="flex items-baseline gap-3 mb-2">
        <div className="h-6 w-36 bg-stone-200 rounded-sm" />
        <div className="h-4 w-28 bg-stone-100 rounded-sm" />
      </div>
      <div className="h-4 w-full bg-stone-100 rounded-sm mb-1.5" />
      <div className="h-4 w-4/5 bg-stone-100 rounded-sm mb-3" />
      <div className="h-3 w-24 bg-stone-100 rounded-sm" />
    </div>
  );
}
