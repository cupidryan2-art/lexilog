import { useReducer, useEffect, useCallback } from 'react';
import type { VocabEntry, Category } from '../types';

const STORAGE_KEY = 'lexilog_entries';
const ROUND_KEY = 'lexilog_current_round';

// --- Sample data seeded on first load ---
const SAMPLE_ENTRIES: VocabEntry[] = [
  {
    id: 'sample-1',
    term: 'silver lining',
    category: 'collocation',
    english_definition: 'A positive aspect of an otherwise negative situation.',
    chinese_translation: '黑暗中的一线光明；塞翁失马',
    example_sentences: [
      'Every cloud has a silver lining — losing that job led me to a better one.',
      'She tried to find the silver lining in the disappointing news.',
    ],
    pronunciation_ipa: '/ˈsɪlvər ˈlaɪnɪŋ/',
    source: 'podcast',
    date_added: '2026-05-15T10:30:00Z',
    starred: true,
    review_count: 2,
    last_reviewed: '2026-05-17T09:00:00Z',
  },
  {
    id: 'sample-2',
    term: 'ephemeral',
    category: 'word',
    english_definition: 'Lasting for a very short time; transitory.',
    chinese_translation: '短暂的，瞬息的',
    example_sentences: [
      "Fame is ephemeral — today's headlines are forgotten by next week.",
      'The ephemeral beauty of cherry blossoms makes them all the more precious.',
    ],
    pronunciation_ipa: '/ɪˈfem.ər.əl/',
    source: 'novel',
    date_added: '2026-05-16T14:00:00Z',
    starred: false,
    review_count: 1,
    last_reviewed: '2026-05-17T09:00:00Z',
  },
  {
    id: 'sample-3',
    term: 'It goes without saying that...',
    category: 'sentence_pattern',
    english_definition: 'Used to introduce something that is obvious or universally understood.',
    chinese_translation: '不言而喻的是……；毋庸置疑……',
    example_sentences: [
      'It goes without saying that hard work leads to success.',
      'It goes without saying that you should always back up your data.',
    ],
    pronunciation_ipa: '/ɪt ɡoʊz wɪˈðaʊt ˈseɪɪŋ ðæt/',
    source: 'work email',
    date_added: '2026-05-17T09:15:00Z',
    starred: false,
    review_count: 0,
  },
  {
    id: 'sample-4',
    term: 'get the ball rolling',
    category: 'collocation',
    english_definition: 'To start an activity or process; to initiate something.',
    chinese_translation: '开始行动；启动某事',
    example_sentences: [
      "Let's get the ball rolling on the new project.",
      'She made the first call to get the ball rolling on the negotiation.',
    ],
    pronunciation_ipa: '/ɡɛt ðə bɔːl ˈroʊlɪŋ/',
    source: 'Netflix show',
    date_added: '2026-05-18T08:00:00Z',
    starred: false,
    review_count: 0,
  },
];

// --- Reducer ---
type Action =
  | { type: 'ADD_ENTRY'; entry: VocabEntry }
  | { type: 'UPDATE_ENTRY'; entry: VocabEntry }
  | { type: 'DELETE_ENTRY'; id: string }
  | { type: 'TOGGLE_STAR'; id: string }
  | { type: 'MARK_REVIEWED'; ids: string[]; round: number }
  | { type: 'LOAD'; entries: VocabEntry[] };

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

function loadFromStorage(): VocabEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return SAMPLE_ENTRIES;
    return JSON.parse(raw) as VocabEntry[];
  } catch {
    return SAMPLE_ENTRIES;
  }
}

function saveToStorage(entries: VocabEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // storage quota exceeded — silently fail
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

export function useVocabStore() {
  const [entries, dispatch] = useReducer(reducer, [], loadFromStorage);
  const currentRound = getCurrentRound();

  useEffect(() => {
    saveToStorage(entries);
  }, [entries]);

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
      return id;
    },
    []
  );

  const updateEntry = useCallback((entry: VocabEntry) => {
    dispatch({ type: 'UPDATE_ENTRY', entry });
  }, []);

  const deleteEntry = useCallback((id: string) => {
    dispatch({ type: 'DELETE_ENTRY', id });
  }, []);

  const toggleStar = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_STAR', id });
  }, []);

  /**
   * Selects up to `count` entries for a review session.
   * Starred entries are always eligible.
   * Non-starred entries are excluded if review_count >= currentRound + 1.
   * If eligible pool < count, bump the round and refresh eligibility.
   */
  const selectForReview = useCallback(
    (count: number = 10): { selected: VocabEntry[]; round: number } => {
      let round = getCurrentRound();

      const isEligible = (e: VocabEntry) => e.starred || e.review_count <= round;
      let eligible = entries.filter(isEligible);

      // If pool is too small (excluding starred), start new round
      const nonStarredEligible = eligible.filter((e) => !e.starred);
      if (nonStarredEligible.length === 0 && entries.filter((e) => !e.starred).length > 0) {
        round += 1;
        saveRound(round);
        eligible = entries.filter((e) => e.starred || e.review_count <= round);
      }

      // Shuffle and pick
      const shuffled = [...eligible].sort(() => Math.random() - 0.5);
      return { selected: shuffled.slice(0, count), round };
    },
    [entries]
  );

  const markReviewed = useCallback((ids: string[], round: number) => {
    dispatch({ type: 'MARK_REVIEWED', ids, round });
  }, []);

  return {
    entries,
    addEntry,
    updateEntry,
    deleteEntry,
    toggleStar,
    selectForReview,
    markReviewed,
    currentRound,
  };
}

export type VocabStore = ReturnType<typeof useVocabStore>;
