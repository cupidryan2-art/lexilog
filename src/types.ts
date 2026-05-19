export type Category = 'word' | 'collocation' | 'sentence_pattern';

export interface VocabEntry {
  id: string;
  term: string;
  category: Category;
  english_definition: string;
  chinese_translation: string;
  example_sentences: string[];
  pronunciation_ipa: string;
  source?: string;
  date_added: string;
  starred: boolean;
  review_count: number;
  last_reviewed?: string;
  cluster_id?: string;
}

export interface WordCluster {
  id: string;
  user_id: string;
  cluster_name: string;
  root: string;
  shared_meaning: string | null;
  key_difference: string | null;
  created_at: string;
}

export type SortOption = 'date_desc' | 'date_asc' | 'starred' | 'alpha';
export type FilterCategory = 'all' | Category;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GrammarError {
  id: string;
  user_id: string;
  original_text: string;
  corrected_text: string;
  reason: string;
  source_session_id: string;
  vocab_context: string[];
  reviewed: boolean;
  created_at: string;
}
