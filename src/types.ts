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
}

export type SortOption = 'date_desc' | 'date_asc' | 'starred' | 'alpha';
export type FilterCategory = 'all' | Category;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
