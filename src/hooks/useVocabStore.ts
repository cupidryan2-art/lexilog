import { useReducer, useEffect, useCallback, useState } from 'react';
import type { VocabEntry } from '../types';
import { supabase } from '../lib/supabase';

const ROUND_KEY = 'lexilog_current_round';

// --- DB row → VocabEntry ---
type DbRow = {
  id: string;
  term: string;
  category: string;
  english_definition: string | null;
  chinese_translation: string | null;
  example_sentences: string[] | null;
  pronunciation_ipa: string | null;
  source: string | null;
  starred: boolean;
  review_count: number;
  last_reviewed: string | null;
  created_at: string;
};

function rowToEntry(row: DbRow): VocabEntry {
  return {
    id: row.id,
    term: row.term,
    category: row.category as VocabEntry['category'],
    english_definition: row.english_definition ?? '',
    chinese_translation: row.chinese_translation ?? '',
    example_sentences: row.example_sentences ?? [],
    pronunciation_ipa: row.pronunciation_ipa ?? '',
    source: row.source ?? undefined,
    date_added: row.created_at,
    starred: row.starred,
    review_count: row.review_count,
    last_reviewed: row.last_reviewed ?? undefined,
  };
}

function entryToRow(entry: VocabEntry, userId: string) {
  return {
    id: entry.id,
    user_id: userId,
    term: entry.term,
    category: entry.category,
    english_definition: entry.english_definition,
    chinese_translation: entry.chinese_translation,
    example_sentences: entry.example_sentences,
    pronunciation_ipa: entry.pronunciation_ipa,
    source: entry.source ?? null,
    starred: entry.starred,
    review_count: entry.review_count,
    last_reviewed: entry.last_reviewed ?? null,
    created_at: entry.date_added,
  };
}

// --- Reducer ---
type Action =
  | { type: 'LOAD'; entries: VocabEntry[] }
  | { type: 'ADD_ENTRY'; entry: VocabEntry }
  | { type: 'UPDATE_ENTRY'; entry: VocabEntry }
  | { type: 'DELETE_ENTRY'; id: string }
  | { type: 'TOGGLE_STAR'; id: string }
  | { type: 'MARK_REVIEWED'; ids: string[]; round: number };

function reducer(state: VocabEntry[], action: Action): VocabEntry[] {
  switch (action.type) {
    case 'LOAD':
      return action.entries;
    case 'ADD_ENTRY':
      return [action.entry, ...state];
    case 'UPDATE_ENTRY':
      return state.map((e) => (e.id === action.entry.id ? action.entry : e));
    case 'DELETE_ENTRY':
      return state.filter((e) => e.id !== action.id);
    case 'TOGGLE_STAR':
      return state.map((e) => (e.id === action.id ? { ...e, starred: !e.starred } : e));
    case 'MARK_REVIEWED':
      return state.map((e) =>
        action.ids.includes(e.id)
          ? { ...e, review_count: action.round + 1, last_reviewed: new Date().toISOString() }
          : e
      );
    default:
      return state;
  }
}

function getCurrentRound(): number {
  try {
    return parseInt(localStorage.getItem(ROUND_KEY) ?? '0', 10);
  } catch {
    return 0;
  }
}

function saveRound(round: number): void {
  try {
    localStorage.setItem(ROUND_KEY, String(round));
  } catch {}
}

export function useVocabStore(userId: string) {
  const [entries, dispatch] = useReducer(reducer, []);
  const [loading, setLoading] = useState(true);

  // Initial fetch from Supabase
  useEffect(() => {
    setLoading(true);
    supabase
      .from('vocab_entries')
      .select('*')
      .order('starred', { ascending: false })
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to load entries:', error.message);
          setLoading(false);
          return;
        }
        const rows = (data ?? []) as DbRow[];
        dispatch({ type: 'LOAD', entries: rows.map(rowToEntry) });
        setLoading(false);
      });
  }, [userId]);

  const addEntry = useCallback(
    (data: Omit<VocabEntry, 'id' | 'date_added' | 'starred' | 'review_count'>): string => {
      const id = crypto.randomUUID();
      const entry: VocabEntry = {
        ...data,
        id,
        date_added: new Date().toISOString(),
        starred: false,
        review_count: 0,
      };
      dispatch({ type: 'ADD_ENTRY', entry });
      supabase.from('vocab_entries').insert(entryToRow(entry, userId));
      return id;
    },
    [userId]
  );

  const updateEntry = useCallback(
    (entry: VocabEntry) => {
      dispatch({ type: 'UPDATE_ENTRY', entry });
      supabase
        .from('vocab_entries')
        .update(entryToRow(entry, userId))
        .eq('id', entry.id);
    },
    [userId]
  );

  const deleteEntry = useCallback(
    (id: string) => {
      dispatch({ type: 'DELETE_ENTRY', id });
      supabase.from('vocab_entries').delete().eq('id', id);
    },
    []
  );

  const toggleStar = useCallback(
    (id: string) => {
      // Read current value before dispatch so we send the correct new value to DB
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      dispatch({ type: 'TOGGLE_STAR', id });
      supabase
        .from('vocab_entries')
        .update({ starred: !entry.starred })
        .eq('id', id);
    },
    [entries]
  );

  const selectForReview = useCallback(
    (count: number = 10): { selected: VocabEntry[]; round: number } => {
      let round = getCurrentRound();
      const isEligible = (e: VocabEntry) => e.starred || e.review_count <= round;
      let eligible = entries.filter(isEligible);

      const nonStarredEligible = eligible.filter((e) => !e.starred);
      if (nonStarredEligible.length === 0 && entries.filter((e) => !e.starred).length > 0) {
        round += 1;
        saveRound(round);
        eligible = entries.filter((e) => e.starred || e.review_count <= round);
      }

      const shuffled = [...eligible].sort(() => Math.random() - 0.5);
      return { selected: shuffled.slice(0, count), round };
    },
    [entries]
  );

  const markReviewed = useCallback(
    (ids: string[], round: number) => {
      const now = new Date().toISOString();
      dispatch({ type: 'MARK_REVIEWED', ids, round });
      supabase
        .from('vocab_entries')
        .update({ review_count: round + 1, last_reviewed: now })
        .in('id', ids);
    },
    []
  );

  return {
    entries,
    loading,
    addEntry,
    updateEntry,
    deleteEntry,
    toggleStar,
    selectForReview,
    markReviewed,
    currentRound: getCurrentRound(),
  };
}

export type VocabStore = ReturnType<typeof useVocabStore>;
