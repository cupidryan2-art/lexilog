import { useState } from 'react';
import type { VocabEntry, WordCluster } from '../types';
import { Volume2, Star, Unlink } from 'lucide-react';

const CATEGORY_LABELS: Record<string, string> = {
  word: 'Word',
  collocation: 'Collocation',
  sentence_pattern: 'Sentence Pattern',
};

interface Props {
  cluster: WordCluster;
  entries: VocabEntry[];
  onToggleStarCluster: (allStarred: boolean) => void;
  onEdit: (entry: VocabEntry) => void;
  onDelete: (id: string) => void;
  onUnlink: () => void;
}

function useSpeaker() {
  const [speaking, setSpeaking] = useState<string | null>(null); // term being spoken

  async function speak(term: string) {
    if (speaking) return;
    setSpeaking(term);
    try {
      const res = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`
      );
      const data = await res.json();
      const phonetics: { audio?: string }[] = data[0]?.phonetics ?? [];
      const audioUrl = phonetics.find((p) => p.audio)?.audio;
      if (audioUrl) {
        const audio = new Audio(audioUrl);
        audio.onended = () => setSpeaking(null);
        audio.onerror = () => { setSpeaking(null); fallback(term); };
        audio.play();
        return;
      }
    } catch { /* fall through */ }
    setSpeaking(null);
    fallback(term);
  }

  function fallback(term: string) {
    const utt = new SpeechSynthesisUtterance(term);
    utt.lang = 'en-US';
    utt.onend = () => setSpeaking(null);
    utt.onerror = () => setSpeaking(null);
    window.speechSynthesis.speak(utt);
    setSpeaking(term);
  }

  return { speaking, speak };
}

export function ClusterCard({ cluster, entries, onToggleStarCluster, onEdit, onDelete, onUnlink }: Props) {
  const { speaking, speak } = useSpeaker();
  const allStarred = entries.every((e) => e.starred);
  const anyStarred = entries.some((e) => e.starred);

  function handleUnlink() {
    if (window.confirm(`Unlink this word family cluster "${cluster.cluster_name}"? All ${entries.length} entries will become independent.`)) {
      onUnlink();
    }
  }

  return (
    <article
      className="bg-white rounded-2xl overflow-hidden"
      style={{
        boxShadow: '0 2px 16px rgba(0,0,0,0.07)',
        borderLeft: anyStarred ? '4px solid #D48B3A' : '4px solid #7C9A7E',
      }}
    >
      {/* Cluster header */}
      <div className="flex items-center justify-between px-5 py-3 bg-[#F4F8F4] border-b border-[#D8E8D8]">
        <div className="flex items-center gap-2">
          <span className="text-[#4A7A4A]">🔗</span>
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#4A7A4A]">
            Word Family
          </span>
          <span className="text-[11px] text-stone-400">·</span>
          <span className="text-[11px] font-mono text-[#5A7A5A]">root: "{cluster.root}"</span>
          <span className="text-[11px] text-stone-300 mx-1">·</span>
          <span className="text-[11px] text-stone-400">{entries.length} words</span>
        </div>
        {/* Cluster-level star */}
        <button
          onClick={() => onToggleStarCluster(allStarred)}
          className={`p-1.5 rounded-lg hover:bg-white/60 transition-colors ${
            anyStarred ? 'text-[#D48B3A]' : 'text-stone-300'
          }`}
          title={allStarred ? 'Unstar all' : 'Star all'}
        >
          <Star size={14} fill={anyStarred ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Entry mini-cards side by side */}
      <div
        className="grid gap-0 divide-x divide-stone-100"
        style={{ gridTemplateColumns: `repeat(${Math.min(entries.length, 2)}, 1fr)` }}
      >
        {entries.map((entry) => (
          <div key={entry.id} className="px-4 pt-4 pb-3 group/entry">
            {/* Category badge + actions */}
            <div className="flex items-start justify-between mb-1.5">
              <span className="text-[10px] font-bold tracking-[0.08em] uppercase px-2 py-[2px] rounded-full bg-[#FFF0E0] text-[#B06A20]">
                {CATEGORY_LABELS[entry.category] ?? 'Word'}
              </span>
              <div className="flex items-center gap-0 opacity-0 group-hover/entry:opacity-100 transition-opacity">
                <button
                  onClick={() => onEdit(entry)}
                  className="p-1 text-stone-300 hover:text-stone-600 text-xs transition-colors"
                  title="Edit"
                >
                  ✎
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete "${entry.term}"?`)) onDelete(entry.id);
                  }}
                  className="p-1 text-stone-300 hover:text-red-400 text-xs transition-colors"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Term + IPA + speaker */}
            <div className="flex items-baseline gap-1.5 flex-wrap mb-1">
              <h3
                className="font-['Playfair_Display'] text-[#1C1917]"
                style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em' }}
              >
                {entry.term}
              </h3>
              <button
                onClick={() => speak(entry.term)}
                className={`p-0.5 rounded-full transition-colors flex-shrink-0 ${
                  speaking === entry.term
                    ? 'text-[#D48B3A]'
                    : 'text-stone-300 hover:text-[#D48B3A]'
                }`}
              >
                <Volume2 size={12} />
              </button>
            </div>
            {entry.pronunciation_ipa && (
              <p className="font-['JetBrains_Mono'] text-[#A0896A] mb-1.5" style={{ fontSize: '11px' }}>
                {entry.pronunciation_ipa}
              </p>
            )}

            {/* Definition */}
            <p className="text-[#3D3530] mb-1.5 leading-snug" style={{ fontSize: '13px' }}>
              {entry.english_definition}
            </p>
            <p
              className="border-l-[2px] border-[#E8D5C0] pl-2 text-[#6B5E54]"
              style={{ fontSize: '12px' }}
            >
              {entry.chinese_translation}
            </p>
          </div>
        ))}
      </div>

      {/* Shared meaning + key difference */}
      {(cluster.shared_meaning || cluster.key_difference) && (
        <div className="mx-4 mb-3 mt-1 rounded-lg bg-[#F4F8F4] border border-[#D8E8D8] px-4 py-3 space-y-2.5">
          {cluster.shared_meaning && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#4A7A4A] mb-1">
                ── What They Share ──
              </p>
              <p className="text-[12px] text-[#3D3530] leading-relaxed">{cluster.shared_meaning}</p>
            </div>
          )}
          {cluster.key_difference && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#4A7A4A] mb-1">
                ── Key Difference ──
              </p>
              <p className="text-[12px] text-[#3D3530] leading-relaxed">{cluster.key_difference}</p>
            </div>
          )}
        </div>
      )}

      {/* Footer: unlink */}
      <div className="flex justify-end px-4 pb-3">
        <button
          onClick={handleUnlink}
          className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-red-500 transition-colors"
        >
          <Unlink size={11} /> Unlink cluster
        </button>
      </div>
    </article>
  );
}
