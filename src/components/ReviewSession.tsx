import { useState, useRef, useEffect } from 'react';
import type { VocabEntry, ChatMessage, ReviewSessionRecord } from '../types';
import { Send, Square, RotateCcw, Loader2, ChevronDown, Plus, Menu, X } from 'lucide-react';
import { getApiKey, DEEPSEEK_URL } from '../lib/apiKey';
import { supabase } from '../lib/supabase';
import { ErrorsTab } from './ErrorsTab';

interface Props {
  userId: string;
  entries: VocabEntry[];
  selectForReview: (count?: number) => { selected: VocabEntry[]; round: number };
  markReviewed: (ids: string[], round: number) => void;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function generateTitle(words: string[], date: Date): string {
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const preview = words.slice(0, 3).join(', ');
  return `${dateStr} · ${preview}${words.length > 3 ? '…' : ''}`;
}

type DbSessionRow = {
  id: string; user_id: string; vocab_words: string[];
  messages: unknown; error_count: number;
  started_at: string; ended_at: string | null; title: string | null;
};

function rowToSession(row: DbSessionRow): ReviewSessionRecord {
  return {
    ...row,
    messages: (row.messages as ChatMessage[]) ?? [],
  };
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(terms: VocabEntry[]): string {
  const termList = terms
    .map((t) => `- ${t.term} (${t.category}): ${t.english_definition}`)
    .join('\n');

  return `You are an English conversation coach helping a learner actively USE vocabulary, not just recognize it.

Target vocabulary for this session:
${termList}

Your goals:
1. Have a natural, engaging conversation on any interesting topic.
2. Gradually steer the conversation so the user NEEDS to use the target vocabulary.
3. When the user successfully uses a target word correctly, acknowledge it naturally — keep the conversation flowing.
4. After EACH user message, follow these two steps in order:

STEP A — Grammar & Usage Check:
If the user made any grammar mistakes or unnatural phrasing, address them FIRST before continuing. Format each correction exactly like this:

🔧 Quick fix: "[user's original phrasing]" → "[corrected version]"
Reason: [one short sentence explaining why]

List each error in its own block. If no errors, skip this section entirely — do not write "No errors."

STEP B — Continue the conversation naturally after any corrections.
Ask questions that create opportunities for the user to use remaining target vocabulary they haven't used yet.

5. Keep track mentally of which target words the user has successfully used. When all have been used, wrap up warmly.
6. NEVER tell the user "now use the word X". Create natural contexts where using that word makes sense.
7. When YOU use one of the target vocabulary items, wrap it in <strong> tags. Example: <strong>silver lining</strong>.

Tone: warm and encouraging but not patronizing — like a smart friend, not a classroom drill.`;
}

// ─── Parse 🔧 correction blocks ───────────────────────────────────────────────

interface ParsedCorrection {
  original_text: string;
  corrected_text: string;
  reason: string;
}

function parseCorrections(text: string): ParsedCorrection[] {
  const results: ParsedCorrection[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const fixMatch = lines[i].match(/🔧\s*Quick fix:\s*"([^"]+)"\s*→\s*"([^"]+)"/);
    if (fixMatch) {
      let reason = '';
      for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
        const m = lines[j].match(/^Reason:\s*(.+)/);
        if (m) { reason = m[1].trim(); break; }
      }
      results.push({ original_text: fixMatch[1], corrected_text: fixMatch[2], reason });
    }
  }
  return results;
}

// ─── Message list (shared between live and read-only views) ───────────────────

function MessageList({
  messages,
  loading,
  error,
  onRetry,
  bottomRef,
}: {
  messages: ChatMessage[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  bottomRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-[#1C1917] text-[#F7F3EE] rounded-2xl rounded-br-[4px]'
                : 'review-message bg-white border border-[#EDE8E0] text-[#1C1917] rounded-2xl rounded-bl-[4px]'
            }`}
            style={{ maxWidth: '75%', padding: '14px 18px', lineHeight: 1.75 }}
            {...(msg.role === 'assistant'
              ? { dangerouslySetInnerHTML: { __html: msg.content } }
              : { children: msg.content })}
          />
        </div>
      ))}

      {loading && (
        <div className="flex justify-start">
          <div className="bg-white border border-[#EDE8E0] rounded-2xl rounded-bl-[4px]"
            style={{ padding: '14px 18px' }}>
            <Loader2 size={16} className="animate-spin text-stone-400" />
          </div>
        </div>
      )}

      {error && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 px-4 py-3 rounded-xl flex items-center gap-2">
          <span className="flex-1">{error}</span>
          {onRetry && (
            <button onClick={onRetry} className="text-xs underline flex-shrink-0 hover:text-red-800">
              Retry
            </button>
          )}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

// ─── Panel type ───────────────────────────────────────────────────────────────

type PanelView = { kind: 'idle' } | { kind: 'active' } | { kind: 'reading'; session: ReviewSessionRecord };

type SessionPhase = 'idle' | 'active' | 'ended';
type ReviewSubTab = 'practice' | 'errors';

// ─── Main component ───────────────────────────────────────────────────────────

export function ReviewSession({ userId, entries, selectForReview, markReviewed, onClose }: Props) {
  // Sub-tabs
  const [subTab, setSubTab] = useState<ReviewSubTab>('practice');
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  const [focusSessionId, setFocusSessionId] = useState<string | undefined>();

  // Sidebar
  const [sessions, setSessions] = useState<ReviewSessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile overlay

  // Panel
  const [panelView, setPanelView] = useState<PanelView>({ kind: 'idle' });

  // Active session
  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [currentDbId, setCurrentDbId] = useState<string | null>(null);
  const [selected, setSelected] = useState<VocabEntry[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionErrors, setSessionErrors] = useState<ParsedCorrection[]>([]);
  const [vocabOpen, setVocabOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Reset textarea height when input clears
  useEffect(() => {
    if (!input && inputRef.current) inputRef.current.style.height = '44px';
  }, [input]);

  // Load past sessions on mount
  useEffect(() => {
    async function load() {
      setSessionsLoading(true);
      const { data, error: err } = await supabase
        .from('review_sessions')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(30);
      if (data && !err) setSessions(data.map(rowToSession));
      setSessionsLoading(false);
    }
    load();
  }, [userId]);

  function handleTextareaInput(e: React.FormEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  // ── Persist messages to Supabase (fire-and-forget) ────────────────────────
  function saveMessages(dbId: string, msgs: ChatMessage[]) {
    supabase
      .from('review_sessions')
      .update({ messages: msgs })
      .eq('id', dbId)
      .then(({ error: err }) => {
        if (err) console.warn('[ReviewSession] saveMessages error:', err.message);
      });
  }

  // ── Start new session ─────────────────────────────────────────────────────
  async function startSession() {
    if (entries.length === 0) {
      setError('Your notebook is empty. Add some entries first!');
      return;
    }

    const { selected: sel, round } = selectForReview(10);
    const now = new Date();
    const words = sel.map((e) => e.term);

    // Create DB row first to get a persistent ID
    const { data: row, error: insertErr } = await supabase
      .from('review_sessions')
      .insert({
        user_id: userId,
        vocab_words: words,
        messages: [],
        error_count: 0,
        started_at: now.toISOString(),
        ended_at: null,
        title: null,
      })
      .select()
      .single();

    if (insertErr || !row) {
      console.warn('[ReviewSession] failed to create session row:', insertErr?.message);
    }

    const dbId = (row as DbSessionRow | null)?.id ?? crypto.randomUUID();

    // Optimistically add to sidebar list
    const optimisticSession: ReviewSessionRecord = {
      id: dbId,
      user_id: userId,
      vocab_words: words,
      messages: [],
      error_count: 0,
      started_at: now.toISOString(),
      ended_at: null,
      title: null,
    };
    setSessions((prev) => [optimisticSession, ...prev]);

    setCurrentDbId(dbId);
    setSelected(sel);
    setCurrentRound(round);
    setMessages([]);
    setError('');
    setSessionErrors([]);
    setVocabOpen(false);
    setPhase('active');
    setPanelView({ kind: 'active' });
    setSidebarOpen(false);

    await sendToAPI(dbId, buildSystemPrompt(sel), [], undefined, sel);
  }

  // ── Send to AI ────────────────────────────────────────────────────────────
  async function sendToAPI(
    dbId: string,
    systemPrompt: string,
    history: ChatMessage[],
    userMessage?: string,
    selOverride?: VocabEntry[]
  ) {
    setLoading(true);
    setError('');

    const historyMsgs: ChatMessage[] = userMessage
      ? [...history, { role: 'user', content: userMessage }]
      : history;

    try {
      const res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          max_tokens: 1000,
          messages: [
            { role: 'system', content: systemPrompt },
            ...historyMsgs.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: { message?: string } }).error?.message ?? `API error ${res.status}`
        );
      }

      const data = (await res.json()) as { choices: { message: { content: string } }[] };
      const reply = data.choices[0]?.message?.content ?? '';

      // Parse grammar corrections
      const corrections = parseCorrections(reply);
      if (corrections.length > 0 && userMessage) {
        setSessionErrors((prev) => [...prev, ...corrections]);
        const vocabContext = (selOverride ?? selected).map((v) => v.term);
        await supabase.from('grammar_errors').insert(
          corrections.map((c) => ({
            user_id: userId,
            original_text: c.original_text,
            corrected_text: c.corrected_text,
            reason: c.reason,
            source_session_id: dbId,
            vocab_context: vocabContext,
            reviewed: false,
          }))
        );
        setUnreviewedCount((n) => n + corrections.length);
      }

      const updatedMsgs: ChatMessage[] = userMessage
        ? [...historyMsgs, { role: 'assistant', content: reply }]
        : [{ role: 'assistant', content: reply }];

      setMessages(updatedMsgs);

      // Persist messages to Supabase (fire-and-forget)
      saveMessages(dbId, updatedMsgs);

      // Update local sessions list so sidebar preview stays fresh
      setSessions((prev) =>
        prev.map((s) => (s.id === dbId ? { ...s, messages: updatedMsgs } : s))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!input.trim() || loading || !currentDbId) return;
    const text = input.trim();
    setInput('');
    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    await sendToAPI(currentDbId, buildSystemPrompt(selected), newMessages.slice(0, -1), text);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function endSession() {
    if (!currentDbId) return;
    const now = new Date();
    const words = selected.map((e) => e.term);
    const title = generateTitle(words, now);
    const errCount = sessionErrors.length;

    markReviewed(selected.map((e) => e.id), currentRound);

    // Update DB row
    supabase
      .from('review_sessions')
      .update({ ended_at: now.toISOString(), title, error_count: errCount })
      .eq('id', currentDbId)
      .then(({ error: err }) => {
        if (err) console.warn('[ReviewSession] endSession update error:', err.message);
      });

    // Update local sessions list
    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentDbId
          ? { ...s, ended_at: now.toISOString(), title, error_count: errCount }
          : s
      )
    );

    setPhase('ended');
  }

  // Heuristic: which target words the user has typed
  const usedTerms = selected.filter((e) =>
    messages
      .filter((m) => m.role === 'user')
      .some((m) => m.content.toLowerCase().includes(e.term.toLowerCase()))
  );

  // ── Sub-tab bar ───────────────────────────────────────────────────────────
  const TabBar = (
    <div className="flex items-center gap-0 border-b border-stone-200 mb-4">
      <button
        onClick={() => setSubTab('practice')}
        className={`px-4 py-2 text-sm border-b-2 transition-colors -mb-px ${
          subTab === 'practice'
            ? 'border-[#D97706] text-[#1C1917] font-medium'
            : 'border-transparent text-stone-500 hover:text-stone-700'
        }`}
      >
        Practice
      </button>
      <button
        onClick={() => setSubTab('errors')}
        className={`px-4 py-2 text-sm border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${
          subTab === 'errors'
            ? 'border-[#D97706] text-[#1C1917] font-medium'
            : 'border-transparent text-stone-500 hover:text-stone-700'
        }`}
      >
        My Errors
        {unreviewedCount > 0 && (
          <span className="text-[11px] font-bold bg-amber-500 text-white rounded-full px-1.5 py-0.5 leading-none">
            {unreviewedCount}
          </span>
        )}
      </button>
    </div>
  );

  // ── My Errors tab ─────────────────────────────────────────────────────────
  if (subTab === 'errors') {
    return (
      <div>
        {TabBar}
        <ErrorsTab userId={userId} onCountChange={setUnreviewedCount} focusSessionId={focusSessionId} />
      </div>
    );
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
  const Sidebar = (
    <aside
      className={`
        absolute sm:static left-0 top-0 bottom-0 z-30
        w-[240px] flex-shrink-0 flex flex-col
        bg-[#F0EDE6] border-r border-stone-200
        transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full sm:translate-x-0'}
      `}
    >
      {/* New session button */}
      <div className="p-3 border-b border-stone-200 flex-shrink-0">
        <button
          onClick={() => {
            setPanelView({ kind: 'idle' });
            setSidebarOpen(false);
          }}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-[#1C1917] bg-white border border-stone-200 rounded-lg hover:border-amber-400 hover:bg-amber-50 transition-colors"
        >
          <Plus size={14} />
          New Session
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-2">
        {sessionsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={16} className="animate-spin text-stone-400" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-xs text-stone-400 text-center py-8 px-4">
            No sessions yet. Start one!
          </p>
        ) : (
          sessions.map((s) => {
            const isActive = s.id === currentDbId && phase === 'active';
            const isViewing =
              (panelView.kind === 'active' && s.id === currentDbId) ||
              (panelView.kind === 'reading' && panelView.session.id === s.id);

            return (
              <button
                key={s.id}
                onClick={() => {
                  if (isActive) {
                    setPanelView({ kind: 'active' });
                  } else {
                    setPanelView({ kind: 'reading', session: s });
                  }
                  setSidebarOpen(false);
                }}
                className={`w-full text-left px-3 py-2.5 transition-colors ${
                  isViewing
                    ? 'bg-amber-50 border-l-2 border-[#D97706]'
                    : 'hover:bg-stone-100 border-l-2 border-transparent'
                }`}
              >
                {/* Date + in-progress badge */}
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                    {s.title ? s.title.split(' · ')[0] : formatDate(s.started_at)}
                  </span>
                  <div className="flex items-center gap-1">
                    {isActive && (
                      <span className="text-[9px] font-bold bg-amber-400 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                        Live
                      </span>
                    )}
                    {s.error_count > 0 && (
                      <span className="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                        🔧 {s.error_count}
                      </span>
                    )}
                  </div>
                </div>
                {/* Word preview */}
                <p className="text-xs text-stone-600 truncate">
                  {s.vocab_words.slice(0, 3).join(', ')}
                  {s.vocab_words.length > 3 ? '…' : ''}
                </p>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );

  // ── Session summary modal ─────────────────────────────────────────────────
  const SummaryModal = phase === 'ended' && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-[#F8F5EE] rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}
      >
        <div className="px-6 py-5">
          <p className="text-3xl text-center mb-2">✅</p>
          <h2 className="font-['Playfair_Display'] text-xl font-bold text-[#1C1917] text-center mb-1">
            Session Complete
          </h2>
          <p className="text-stone-500 text-sm text-center mb-5">
            {selected.length} words practiced · {sessionErrors.length} correction
            {sessionErrors.length !== 1 ? 's' : ''} caught
          </p>

          <div className="space-y-1.5 mb-5">
            {selected.map((e) => {
              const used = usedTerms.some((u) => u.id === e.id);
              return (
                <div key={e.id}
                  className="flex items-center gap-2.5 px-3 py-2 bg-white rounded-lg border border-stone-200">
                  <span className={`text-sm ${used ? 'text-emerald-500' : 'text-stone-300'}`}>
                    {used ? '✓' : '○'}
                  </span>
                  <span className="text-sm font-medium text-[#1C1917] flex-1">{e.term}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-stone-100 text-stone-400 rounded capitalize">
                    {e.category.replace('_', ' ')}
                  </span>
                  {e.starred && <span className="text-amber-400 text-xs">★</span>}
                </div>
              );
            })}
          </div>

          {sessionErrors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5 text-sm text-amber-800">
              🔧 <span className="font-semibold">{sessionErrors.length} grammar correction
              {sessionErrors.length !== 1 ? 's' : ''}</span> saved to My Errors.
            </div>
          )}

          <div className="flex flex-col gap-2">
            {sessionErrors.length > 0 && (
              <button
                onClick={() => {
                  setFocusSessionId(currentDbId ?? undefined);
                  setPhase('idle');
                  setMessages([]);
                  setSelected([]);
                  setPanelView({ kind: 'idle' });
                  setSubTab('errors');
                }}
                className="w-full py-2.5 text-sm font-semibold bg-[#D97706] text-white rounded-lg hover:bg-amber-700 transition-colors"
              >
                View My Errors →
              </button>
            )}
            <button
              onClick={() => {
                setPhase('idle');
                setMessages([]);
                setSelected([]);
                setSessionErrors([]);
                setCurrentDbId(null);
                setPanelView({ kind: 'idle' });
              }}
              className="w-full py-2.5 text-sm font-medium border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-100 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw size={14} /> New Session
            </button>
            <button
              onClick={onClose}
              className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors"
            >
              Back to Notebook
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Right panel content ───────────────────────────────────────────────────

  // Idle: show start screen
  const IdlePanel = (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm">
        <p className="text-5xl mb-4">💬</p>
        <h2 className="font-['Playfair_Display'] text-2xl font-semibold text-[#1C1917] mb-3">
          Conversation Practice
        </h2>
        <p className="text-stone-500 text-sm mb-6 leading-relaxed">
          The AI picks 10 words from your notebook, steers a natural conversation, and corrects
          grammar in real time — saving errors to{' '}
          <button
            onClick={() => setSubTab('errors')}
            className="text-[#D4883A] underline underline-offset-2 hover:text-amber-700"
          >
            My Errors
          </button>
          .
        </p>
        {entries.length === 0 && (
          <p className="text-amber-700 text-sm mb-4 bg-amber-50 border border-amber-200 px-4 py-2 rounded-sm">
            Add some entries to your notebook first.
          </p>
        )}
        {error && (
          <p className="text-red-600 text-sm mb-4 bg-red-50 border border-red-200 px-4 py-2 rounded-sm">
            {error}
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-stone-600 hover:text-stone-900 transition-colors"
          >
            Back
          </button>
          <button
            onClick={startSession}
            disabled={entries.length === 0 || loading}
            className="px-6 py-2 bg-[#D97706] text-white text-sm rounded-sm hover:bg-amber-700 transition-colors font-medium disabled:opacity-40 flex items-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Start Session
          </button>
        </div>
      </div>
    </div>
  );

  // Read-only: past session viewer
  const ReadingPanel = panelView.kind === 'reading' ? (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Session header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-[#EDE8E0] flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide truncate">
            {panelView.session.title ?? formatDate(panelView.session.started_at)}
          </p>
          <p className="text-xs text-stone-400 truncate">
            {panelView.session.vocab_words.join(', ')}
          </p>
        </div>
        {panelView.session.error_count > 0 && (
          <span className="flex-shrink-0 text-xs text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
            🔧 {panelView.session.error_count} correction{panelView.session.error_count !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5" style={{ scrollBehavior: 'smooth' }}>
        {panelView.session.messages.length === 0 ? (
          <p className="text-center text-stone-400 text-sm py-12">No messages in this session.</p>
        ) : (
          <MessageList messages={panelView.session.messages} />
        )}
      </div>
      <div className="flex-shrink-0 px-5 py-3 border-t border-[#EDE8E0]">
        <p className="text-xs text-stone-400 text-center italic">This session has ended — read only</p>
      </div>
    </div>
  ) : null;

  // Active chat panel
  const ActivePanel = (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Collapsible vocab chips + End button */}
      <div className="flex-shrink-0 px-5 border-b border-[#EDE8E0]">
        <div className="flex items-center justify-between py-2">
          <button
            onClick={() => setVocabOpen((v) => !v)}
            className="flex items-center gap-2 text-xs text-stone-500 hover:text-stone-700 transition-colors"
          >
            <span>
              📚 <span className="font-medium">{selected.length} words</span>
              {usedTerms.length > 0 && (
                <span className="text-emerald-600 ml-1">· {usedTerms.length} used ✓</span>
              )}
            </span>
            <ChevronDown
              size={13}
              className={`transition-transform duration-200 ${vocabOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <button
            onClick={endSession}
            className="flex items-center gap-1.5 px-3 py-1 text-xs text-stone-500 border border-stone-200 rounded-sm hover:border-stone-400 hover:text-stone-700 transition-colors"
          >
            <Square size={11} /> End session
          </button>
        </div>
        {vocabOpen && (
          <div className="pb-3 flex flex-wrap gap-1.5">
            {selected.map((e) => {
              const used = usedTerms.some((u) => u.id === e.id);
              return (
                <span
                  key={e.id}
                  className={`text-xs px-2 py-0.5 border rounded-sm transition-colors ${
                    used
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  {e.starred ? '★ ' : ''}{e.term}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5" style={{ scrollBehavior: 'smooth' }}>
        <MessageList
          messages={messages}
          loading={loading}
          error={error}
          onRetry={() => currentDbId && sendToAPI(currentDbId, buildSystemPrompt(selected), messages)}
          bottomRef={bottomRef}
        />
      </div>

      {/* Input bar */}
      <div
        className="flex-shrink-0 border-t border-[#EDE8E0] flex gap-3 items-end px-5"
        style={{ padding: '14px 20px' }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onInput={handleTextareaInput}
          onKeyDown={handleKeyDown}
          placeholder="Reply here… (Enter to send, Shift+Enter for newline)"
          className="flex-1 px-4 py-2.5 border border-stone-300 rounded-xl bg-white text-sm text-[#1C1917] focus:outline-none focus:border-amber-500 transition-colors overflow-y-auto resize-none"
          style={{ minHeight: '44px', maxHeight: '120px', lineHeight: 1.5 }}
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || loading}
          className="flex-shrink-0 p-2.5 bg-[#D97706] text-white rounded-xl hover:bg-amber-700 transition-colors disabled:opacity-40"
          title="Send (Enter)"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );

  // ── Full layout ───────────────────────────────────────────────────────────
  return (
    <div>
      {TabBar}
      {SummaryModal}

      {/* Two-panel container */}
      <div
        className="relative flex border border-stone-200 rounded-xl overflow-hidden"
        style={{ height: 'calc(100vh - 200px)' }}
      >
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 bg-black/25 z-20 sm:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {Sidebar}

        {/* Right panel */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#FDFCF9]">
          {/* Mobile header: hamburger + current context */}
          <div className="sm:hidden flex items-center gap-2 px-4 py-2.5 border-b border-stone-200 flex-shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 text-stone-500 hover:text-stone-700 transition-colors"
            >
              <Menu size={18} />
            </button>
            <span className="text-xs text-stone-500 truncate flex-1">
              {panelView.kind === 'active'
                ? `Session in progress · ${selected.length} words`
                : panelView.kind === 'reading'
                ? panelView.session.title ?? formatDate(panelView.session.started_at)
                : 'Practice'}
            </span>
            {phase === 'active' && (
              <span className="text-[9px] font-bold bg-amber-400 text-white px-1.5 py-0.5 rounded-full uppercase">
                Live
              </span>
            )}
          </div>

          {/* Panel content */}
          {panelView.kind === 'idle' && IdlePanel}
          {panelView.kind === 'reading' && ReadingPanel}
          {panelView.kind === 'active' && ActivePanel}

          {/* Close mobile sidebar button when sidebar is open */}
          {sidebarOpen && (
            <button
              className="absolute top-3 right-3 z-40 sm:hidden p-1.5 bg-white rounded-full shadow text-stone-500 hover:text-stone-700"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
