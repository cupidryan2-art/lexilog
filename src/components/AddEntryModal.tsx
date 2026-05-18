import { useState, useEffect } from 'react';
import type { VocabEntry, Category } from '../types';
import { X, Plus, Minus } from 'lucide-react';

interface Props {
  entry?: VocabEntry | null;
  onSave: (data: Omit<VocabEntry, 'id' | 'date_added' | 'starred' | 'review_count'> | VocabEntry) => void;
  onClose: () => void;
}

const EMPTY_FORM = {
  term: '',
  category: 'word' as Category,
  english_definition: '',
  chinese_translation: '',
  example_sentences: ['', ''],
  pronunciation_ipa: '',
  source: '',
};

export function AddEntryModal({ entry, onSave, onClose }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (entry) {
      setForm({
        term: entry.term,
        category: entry.category,
        english_definition: entry.english_definition,
        chinese_translation: entry.chinese_translation,
        example_sentences: entry.example_sentences.length > 0 ? entry.example_sentences : ['', ''],
        pronunciation_ipa: entry.pronunciation_ipa ?? '',
        source: entry.source ?? '',
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [entry]);

  function updateSentence(i: number, val: string) {
    const updated = [...form.example_sentences];
    updated[i] = val;
    setForm((f) => ({ ...f, example_sentences: updated }));
  }

  function addSentence() {
    setForm((f) => ({ ...f, example_sentences: [...f.example_sentences, ''] }));
  }

  function removeSentence(i: number) {
    if (form.example_sentences.length <= 1) return;
    const updated = form.example_sentences.filter((_, idx) => idx !== i);
    setForm((f) => ({ ...f, example_sentences: updated }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = {
      ...form,
      example_sentences: form.example_sentences.filter((s) => s.trim() !== ''),
    };
    if (entry) {
      onSave({ ...entry, ...cleaned });
    } else {
      onSave(cleaned);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-[#F8F5EE] rounded-sm shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-stone-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200">
          <h2 className="font-['Playfair_Display'] text-xl font-semibold text-[#1C1917]">
            {entry ? 'Edit Entry' : 'New Entry'}
          </h2>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Category */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-stone-500 mb-1.5">
              Category
            </label>
            <div className="flex gap-2">
              {(['word', 'collocation', 'sentence_pattern'] as Category[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, category: c }))}
                  className={`flex-1 py-1.5 text-xs rounded-sm border transition-colors font-medium ${
                    form.category === c
                      ? 'bg-[#D97706] text-white border-[#D97706]'
                      : 'bg-white text-stone-600 border-stone-300 hover:border-stone-400'
                  }`}
                >
                  {c === 'word' ? 'Word' : c === 'collocation' ? 'Collocation' : 'Sentence Pattern'}
                </button>
              ))}
            </div>
          </div>

          {/* Term */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-stone-500 mb-1.5">
              Term *
            </label>
            <input
              required
              value={form.term}
              onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
              placeholder="e.g. silver lining"
              className="w-full px-3 py-2 border border-stone-300 rounded-sm bg-white text-[#1C1917] text-sm font-['Source_Serif_4'] focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {/* IPA */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-stone-500 mb-1.5">
              IPA Pronunciation
            </label>
            <input
              value={form.pronunciation_ipa}
              onChange={(e) => setForm((f) => ({ ...f, pronunciation_ipa: e.target.value }))}
              placeholder="e.g. /ˈsɪlvər ˈlaɪnɪŋ/"
              className="w-full px-3 py-2 border border-stone-300 rounded-sm bg-white text-stone-700 text-sm font-mono focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {/* English definition */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-stone-500 mb-1.5">
              English Definition *
            </label>
            <textarea
              required
              value={form.english_definition}
              onChange={(e) => setForm((f) => ({ ...f, english_definition: e.target.value }))}
              rows={2}
              placeholder="A clear explanation in English..."
              className="w-full px-3 py-2 border border-stone-300 rounded-sm bg-white text-[#1C1917] text-sm resize-none focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {/* Chinese translation */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-stone-500 mb-1.5">
              Chinese Translation *
            </label>
            <input
              required
              value={form.chinese_translation}
              onChange={(e) => setForm((f) => ({ ...f, chinese_translation: e.target.value }))}
              placeholder="中文翻译"
              className="w-full px-3 py-2 border border-stone-300 rounded-sm bg-white text-[#1C1917] text-sm focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {/* Example sentences */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-stone-500 mb-1.5">
              Example Sentences
            </label>
            <div className="space-y-2">
              {form.example_sentences.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={s}
                    onChange={(e) => updateSentence(i, e.target.value)}
                    placeholder={`Example ${i + 1}...`}
                    className="flex-1 px-3 py-2 border border-stone-300 rounded-sm bg-white text-[#1C1917] text-sm focus:outline-none focus:border-amber-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => removeSentence(i)}
                    className="p-2 text-stone-400 hover:text-red-400 transition-colors"
                  >
                    <Minus size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addSentence}
              className="mt-2 flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 transition-colors"
            >
              <Plus size={12} /> Add sentence
            </button>
          </div>

          {/* Source */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-stone-500 mb-1.5">
              Source (optional)
            </label>
            <input
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
              placeholder="e.g. Netflix show, work email, podcast..."
              className="w-full px-3 py-2 border border-stone-300 rounded-sm bg-white text-stone-600 text-sm focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2 border-t border-stone-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-stone-600 hover:text-stone-900 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-[#1C1917] text-white text-sm rounded-sm hover:bg-stone-700 transition-colors font-medium"
            >
              {entry ? 'Save Changes' : 'Add Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
