import { useState, useMemo } from 'react';
import type { VocabEntry, SortOption, FilterCategory } from '../types';
import { EntryCard } from './EntryCard';
import { QuickAdd } from './QuickAdd';
import { Search, SlidersHorizontal } from 'lucide-react';

interface Props {
  entries: VocabEntry[];
  onAdd: (data: Omit<VocabEntry, 'id' | 'date_added' | 'starred' | 'review_count'>) => string;
  onEdit: (entry: VocabEntry) => void;
  onDelete: (id: string) => void;
  onToggleStar: (id: string) => void;
}

export function VocabNotebook({ entries, onAdd, onEdit, onDelete, onToggleStar }: Props) {
  const [query, setQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('all');
  const [sort, setSort] = useState<SortOption>('starred');
  const [showFilters, setShowFilters] = useState(false);
  const [newEntryId, setNewEntryId] = useState<string | null>(null);

  function handleAdd(data: Omit<VocabEntry, 'id' | 'date_added' | 'starred' | 'review_count'>) {
    const id = onAdd(data);
    setNewEntryId(id);
    // Clear the highlight after the animation completes
    setTimeout(() => setNewEntryId(null), 800);
  }

  const filtered = useMemo(() => {
    let list = [...entries];

    if (filterCategory !== 'all') {
      list = list.filter((e) => e.category === filterCategory);
    }

    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (e) =>
          e.term.toLowerCase().includes(q) ||
          e.english_definition.toLowerCase().includes(q) ||
          e.chinese_translation.includes(q) ||
          e.example_sentences.some((s) => s.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      if (sort === 'starred') {
        if (a.starred !== b.starred) return a.starred ? -1 : 1;
        return new Date(b.date_added).getTime() - new Date(a.date_added).getTime();
      }
      if (sort === 'date_desc') return new Date(b.date_added).getTime() - new Date(a.date_added).getTime();
      if (sort === 'date_asc') return new Date(a.date_added).getTime() - new Date(b.date_added).getTime();
      if (sort === 'alpha') return a.term.localeCompare(b.term);
      return 0;
    });

    return list;
  }, [entries, query, filterCategory, sort]);

  const categoryOptions: { value: FilterCategory; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'word', label: 'Words' },
    { value: 'collocation', label: 'Collocations' },
    { value: 'sentence_pattern', label: 'Sentence Patterns' },
  ];

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: 'starred', label: 'Starred first' },
    { value: 'date_desc', label: 'Newest' },
    { value: 'date_asc', label: 'Oldest' },
    { value: 'alpha', label: 'A–Z' },
  ];

  return (
    <div>
      {/* AI Quick-add */}
      <QuickAdd onAdded={handleAdd} />

      {/* Search + filter bar */}
      <div className="mb-5 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search terms, definitions, examples..."
              className="w-full pl-9 pr-4 py-2 border border-stone-300 rounded-sm bg-white text-sm text-[#1C1917] focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-sm text-sm transition-colors ${
              showFilters
                ? 'border-amber-500 bg-amber-50 text-amber-800'
                : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400'
            }`}
          >
            <SlidersHorizontal size={14} />
            <span className="hidden sm:inline">Filter</span>
          </button>
        </div>

        {showFilters && (
          <div className="flex flex-col sm:flex-row gap-3 p-3 bg-stone-50 border border-stone-200 rounded-sm">
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-1.5">Category</p>
              <div className="flex flex-wrap gap-1.5">
                {categoryOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFilterCategory(opt.value)}
                    className={`px-2.5 py-1 text-xs rounded-sm border transition-colors ${
                      filterCategory === opt.value
                        ? 'bg-[#D97706] text-white border-[#D97706]'
                        : 'bg-white text-stone-600 border-stone-300 hover:border-stone-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-1.5">Sort by</p>
              <div className="flex flex-wrap gap-1.5">
                {sortOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSort(opt.value)}
                    className={`px-2.5 py-1 text-xs rounded-sm border transition-colors ${
                      sort === opt.value
                        ? 'bg-[#1C1917] text-white border-[#1C1917]'
                        : 'bg-white text-stone-600 border-stone-300 hover:border-stone-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Result count */}
      <p className="mb-3 uppercase tracking-[0.1em] text-[#B0A090]" style={{ fontSize: '12px' }}>
        {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
        {query && ` matching "${query}"`}
      </p>

      {/* Entry grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-stone-400">
          <p className="text-5xl mb-3">📖</p>
          <p className="text-sm">
            {query
              ? 'No entries match your search.'
              : 'Type a word above to add your first entry!'}
          </p>
        </div>
      ) : (
        <div className="vocab-grid">
          {filtered.map((entry) => (
            <div key={entry.id} className="vocab-card">
              <EntryCard
                entry={entry}
                isNew={entry.id === newEntryId}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggleStar={onToggleStar}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
