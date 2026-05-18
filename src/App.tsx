import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { useVocabStore } from './hooks/useVocabStore';
import { VocabNotebook } from './components/VocabNotebook';
import { AddEntryModal } from './components/AddEntryModal';
import { ReviewSession } from './components/ReviewSession';
import { KeySetupOverlay } from './components/KeySetupOverlay';
import { AuthScreen } from './components/AuthScreen';
import type { VocabEntry } from './types';
import { getApiKey, saveApiKey } from './lib/apiKey';
import { BookOpen, MessageSquare, KeyRound, LogOut } from 'lucide-react';

type Tab = 'notebook' | 'review';

// --- Authenticated app shell ---
function AppShell({ session }: { session: Session }) {
  const store = useVocabStore(session.user.id);
  const [tab, setTab] = useState<Tab>('notebook');
  const [editingEntry, setEditingEntry] = useState<VocabEntry | null>(null);
  const [apiKey, setApiKey] = useState<string>(() => getApiKey());
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [pendingKey, setPendingKey] = useState('');

  function handleEditSave(entry: VocabEntry) {
    store.updateEntry(entry);
    setEditingEntry(null);
  }

  function handleKeySave() {
    const trimmed = pendingKey.trim();
    if (!trimmed) return;
    saveApiKey(trimmed);
    setApiKey(trimmed);
    setShowKeyInput(false);
    setPendingKey('');
  }

  const starredCount = store.entries.filter((e) => e.starred).length;

  if (!apiKey) {
    return <KeySetupOverlay onDone={setApiKey} />;
  }

  return (
    <div className="min-h-screen bg-[#F8F5EE] font-['Source_Serif_4']">
      {/* Header */}
      <header className="border-b border-stone-200 bg-[#F8F5EE]/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#1C1917] rounded-sm flex items-center justify-center">
              <span className="text-white text-xs font-bold font-['Playfair_Display']">L</span>
            </div>
            <div>
              <h1
                className="font-['Playfair_Display'] text-lg text-[#1C1917] leading-none"
                style={{ fontWeight: 900 }}
              >
                LexiLog
              </h1>
              <p
                className="text-[10px] text-stone-400 tracking-widest uppercase leading-none mt-0.5"
                style={{ opacity: 0.45 }}
              >
                Vocabulary Companion
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <span className="hidden sm:inline text-xs text-stone-400 mr-2">
              {store.entries.length} entries · {starredCount} starred
            </span>
            <button
              onClick={() => { setPendingKey(apiKey); setShowKeyInput((v) => !v); }}
              className="p-2 text-stone-400 hover:text-stone-700 transition-colors rounded hover:bg-stone-100"
              title="Update DeepSeek API key"
            >
              <KeyRound size={15} />
            </button>
            <button
              onClick={() => supabase.auth.signOut()}
              className="p-2 text-stone-400 hover:text-stone-700 transition-colors rounded hover:bg-stone-100"
              title={`Sign out (${session.user.email})`}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        {/* Inline key-update bar */}
        {showKeyInput && (
          <div className="border-t border-stone-200 bg-stone-50">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-2">
              <span className="text-xs text-stone-500 flex-shrink-0">DeepSeek API key:</span>
              <input
                type="password"
                value={pendingKey}
                onChange={(e) => setPendingKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleKeySave();
                  if (e.key === 'Escape') setShowKeyInput(false);
                }}
                placeholder="sk-..."
                autoFocus
                className="flex-1 px-2 py-1 text-xs font-mono border border-stone-300 rounded-sm bg-white focus:outline-none focus:border-amber-500 min-w-0"
              />
              <button
                onClick={handleKeySave}
                disabled={!pendingKey.trim()}
                className="px-3 py-1 text-xs font-semibold bg-[#1C1917] text-white rounded-sm hover:bg-stone-700 disabled:opacity-40 transition-colors flex-shrink-0"
              >
                Save
              </button>
              <button
                onClick={() => setShowKeyInput(false)}
                className="text-xs text-stone-400 hover:text-stone-600 transition-colors flex-shrink-0"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Nav tabs */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex border-t border-stone-100">
          <button
            onClick={() => setTab('notebook')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 transition-colors ${
              tab === 'notebook'
                ? 'border-[#D97706] text-[#1C1917] font-medium'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            <BookOpen size={15} /> Notebook
          </button>
          <button
            onClick={() => setTab('review')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 transition-colors ${
              tab === 'review'
                ? 'border-[#D97706] text-[#1C1917] font-medium'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            <MessageSquare size={15} /> Review
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {store.loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 border-2 border-stone-300 border-t-[#D4883A] rounded-full animate-spin" />
          </div>
        ) : tab === 'notebook' ? (
          <VocabNotebook
            entries={store.entries}
            onAdd={store.addEntry}
            onEdit={setEditingEntry}
            onDelete={store.deleteEntry}
            onToggleStar={store.toggleStar}
          />
        ) : (
          <ReviewSession
            entries={store.entries}
            selectForReview={store.selectForReview}
            markReviewed={store.markReviewed}
            onClose={() => setTab('notebook')}
          />
        )}
      </main>

      {editingEntry && (
        <AddEntryModal
          entry={editingEntry}
          onSave={(data) => handleEditSave(data as VocabEntry)}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}

// --- Root: auth gate ---
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F8F5EE] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-stone-300 border-t-[#D4883A] rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return <AppShell session={session} />;
}
