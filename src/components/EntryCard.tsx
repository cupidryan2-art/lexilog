import { useState } from 'react';
import type { VocabEntry } from '../types';
import { Star, Edit2, Trash2, Volume2, ChevronDown, ChevronUp } from 'lucide-react';

const CATEGORY_LABELS: Record<string, string> = {
  word: 'Word',
  collocation: 'Collocation',
  sentence_pattern: 'Sentence Pattern',
};

interface Props {
  entry: VocabEntry;
  isNew?: boolean;
  onEdit: (entry: VocabEntry) => void;
  onDelete: (id: string) => void;
  onToggleStar: (id: string) => void;
}

export function EntryCard({ entry, isNew = false, onEdit, onDelete, onToggleStar }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const label = CATEGORY_LABELS[entry.category] ?? 'Word';

  function speak() {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(entry.term);
    utt.lang = 'en-US';
    utt.onstart = () => setSpeaking(true);
    utt.onend = () => setSpeaking(false);
    utt.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utt);
  }

  function handleDelete() {
    if (window.confirm(`Delete "${entry.term}"?`)) {
      onDelete(entry.id);
    }
  }

  return (
    <article
      className={`group relative bg-[#F8F5EE] rounded-2xl transition-all duration-200 hover:-translate-y-0.5 ${
        isNew ? 'animate-[slideIn_0.4s_ease-out]' : ''
      }`}
      style={{
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        borderLeft: entry.starred ? '4px solid #D48B3A' : undefined,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.10)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)';
      }}
    >
      {/* Top bar */}
      <div className="flex items-start justify-between px-[22px] pt-5 pb-2">
        <span className="text-[10px] font-bold tracking-[0.08em] uppercase px-2.5 py-[3px] rounded-full bg-[#FFF0E0] text-[#B06A20]">
          {label}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onToggleStar(entry.id)}
            className={`p-1.5 rounded-lg hover:bg-stone-100 transition-colors ${entry.starred ? 'text-[#D48B3A]' : 'text-stone-300'}`}
            title={entry.starred ? 'Unstar' : 'Star'}
          >
            <Star size={14} fill={entry.starred ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={() => onEdit(entry)}
            className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-300 hover:text-stone-600 transition-colors"
            title="Edit"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Term + IPA + TTS */}
      <div className="px-[22px] pb-3 flex items-baseline gap-3 flex-wrap">
        <h3
          className="font-['Playfair_Display'] text-[#1C1917] leading-tight"
          style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em' }}
        >
          {entry.term}
        </h3>
        {entry.pronunciation_ipa && (
          <span
            className="font-['JetBrains_Mono'] text-[#A0896A]"
            style={{ fontSize: '13px' }}
          >
            {entry.pronunciation_ipa}
          </span>
        )}
        <button
          onClick={speak}
          className={`p-1 rounded-full transition-colors flex-shrink-0 ${
            speaking ? 'text-[#D48B3A] bg-amber-50' : 'text-stone-300 hover:text-[#D48B3A] hover:bg-amber-50'
          }`}
          title="Pronounce"
        >
          <Volume2 size={14} />
        </button>
      </div>

      {/* Definition */}
      <div className="px-[22px] pb-4 space-y-2.5">
        <p style={{ fontSize: '15px', lineHeight: 1.7, color: '#3D3530' }}>
          {entry.english_definition}
        </p>
        <p
          className="border-l-[3px] border-[#E8D5C0] pl-[10px]"
          style={{ fontSize: '15px', color: '#6B5E54' }}
        >
          {entry.chinese_translation}
        </p>
      </div>

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-[22px] py-2.5 text-[11px] text-[#B0A090] hover:text-stone-500 border-t border-[#F0E8DE] transition-colors"
      >
        <span className="tracking-wide">Examples · {entry.example_sentences.length}</span>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {/* Expanded section */}
      {expanded && (
        <div className="px-[22px] pb-5 pt-1 space-y-3">
          {entry.example_sentences.map((s, i) => (
            <p key={i} className="text-[#3D3530] leading-relaxed" style={{ fontSize: '14px' }}>
              <span className="text-[#D48B3A] font-['Playfair_Display'] mr-0.5" style={{ fontSize: '18px', lineHeight: 1 }}>"</span>
              {s}
            </p>
          ))}
          {entry.source && (
            <p className="text-[11px] text-[#B0A090] pt-1">
              Source: <span className="text-[#6B5E54]">{entry.source}</span>
            </p>
          )}
          <p className="text-[11px] text-[#B0A090]">
            Added {new Date(entry.date_added).toLocaleDateString()} ·{' '}
            Reviewed {entry.review_count}×
            {entry.last_reviewed && ` · Last: ${new Date(entry.last_reviewed).toLocaleDateString()}`}
          </p>
        </div>
      )}
    </article>
  );
}
