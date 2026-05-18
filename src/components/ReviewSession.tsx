import { useState, useRef, useEffect } from 'react';
import type { VocabEntry, ChatMessage } from '../types';
import { Send, Square, RotateCcw, Loader2 } from 'lucide-react';

import { getApiKey, DEEPSEEK_URL } from '../lib/apiKey';

interface Props {
  entries: VocabEntry[];
  selectForReview: (count?: number) => { selected: VocabEntry[]; round: number };
  markReviewed: (ids: string[], round: number) => void;
  onClose: () => void;
}

function buildSystemPrompt(terms: VocabEntry[]): string {
  const termList = terms.map((t) => `- **${t.term}** (${t.category}): ${t.english_definition}`).join('\n');
  return `You are an engaging, warm English conversation partner helping a learner practice vocabulary.

Your task is to weave the following 10 vocabulary items naturally into a flowing, contextual conversation:

${termList}

Guidelines:
- Begin with a friendly, conversational opener and immediately start using some of the vocabulary items naturally
- Ask questions that encourage the learner to use these words themselves
- When you use one of the vocabulary items, wrap it in <strong> tags. Example: <strong>silver lining</strong>. Do NOT use asterisks.
- If the learner misuses a term, gently correct them: "Great try! Just a small note — 'X' is usually used like..."
- Keep the conversation warm, intellectually engaging, and natural — like chatting with a knowledgeable friend
- Don't robotically list all 10 words; weave them in gradually over the conversation
- Aim for medium-length responses that move the dialogue forward
- Never break character or refer to yourself as an AI`;
}

type SessionPhase = 'idle' | 'active' | 'ended';

export function ReviewSession({ entries, selectForReview, markReviewed, onClose }: Props) {
  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [selected, setSelected] = useState<VocabEntry[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function startSession() {
    if (entries.length === 0) {
      setError('Your notebook is empty. Add some entries first!');
      return;
    }

    const { selected: sel, round } = selectForReview(10);
    setSelected(sel);
    setCurrentRound(round);
    setMessages([]);
    setError('');
    setPhase('active');

    await sendToAPI(buildSystemPrompt(sel), []);
  }

  async function sendToAPI(systemPrompt: string, history: ChatMessage[], userMessage?: string) {
    setLoading(true);
    setError('');

    const historyMsgs = userMessage
      ? [...history, { role: 'user' as const, content: userMessage }]
      : history;

    try {
      const res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getApiKey()}`,
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
        throw new Error((err as { error?: { message?: string } }).error?.message ?? `API error ${res.status}`);
      }

      const data = await res.json() as { choices: { message: { content: string } }[] };
      const reply = data.choices[0]?.message?.content ?? '';

      const updatedMsgs: ChatMessage[] = userMessage
        ? [...historyMsgs, { role: 'assistant', content: reply }]
        : [{ role: 'assistant', content: reply }];

      setMessages(updatedMsgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    await sendToAPI(buildSystemPrompt(selected), newMessages.slice(0, -1), text);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function endSession() {
    markReviewed(selected.map((e) => e.id), currentRound);
    setPhase('ended');
  }

  // --- Idle screen ---
  if (phase === 'idle') {
    return (
      <div className="max-w-xl mx-auto text-center py-12">
        <p className="text-5xl mb-4">💬</p>
        <h2 className="font-['Playfair_Display'] text-2xl font-semibold text-[#1C1917] mb-3">
          Conversation Practice
        </h2>
        <p className="text-stone-500 text-sm mb-6 leading-relaxed">
          Start a review session and Claude will pick up to 10 vocabulary items from your notebook
          and weave them into a natural conversation — asking you questions and gently guiding you
          to use the words yourself.
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
            disabled={entries.length === 0}
            className="px-6 py-2 bg-[#D97706] text-white text-sm rounded-sm hover:bg-amber-700 transition-colors font-medium disabled:opacity-40"
          >
            Start Session
          </button>
        </div>
      </div>
    );
  }

  // --- Post-session summary ---
  if (phase === 'ended') {
    return (
      <div className="max-w-xl mx-auto py-10">
        <p className="text-4xl text-center mb-4">✅</p>
        <h2 className="font-['Playfair_Display'] text-2xl font-semibold text-[#1C1917] text-center mb-2">
          Session Complete
        </h2>
        <p className="text-stone-500 text-sm text-center mb-8">
          These {selected.length} entries have been marked as reviewed.
        </p>

        <div className="space-y-2 mb-8">
          {selected.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 bg-[#F8F5EE] border border-stone-200 rounded-sm">
              <span className="text-xs px-1.5 py-0.5 bg-stone-100 text-stone-500 rounded-sm border border-stone-200 capitalize">
                {e.category.replace('_', ' ')}
              </span>
              <span className="text-sm font-medium text-[#1C1917]">{e.term}</span>
              {e.starred && <span className="text-amber-500 text-xs ml-auto">★</span>}
            </div>
          ))}
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-stone-600 hover:text-stone-900 transition-colors"
          >
            Back to Notebook
          </button>
          <button
            onClick={() => { setPhase('idle'); setMessages([]); setSelected([]); }}
            className="flex items-center gap-2 px-5 py-2 bg-[#1C1917] text-white text-sm rounded-sm hover:bg-stone-700 transition-colors"
          >
            <RotateCcw size={14} /> New Session
          </button>
        </div>
      </div>
    );
  }

  // --- Active chat ---
  return (
    <div className="flex flex-col h-[calc(100vh-180px)] max-w-2xl mx-auto">
      {/* Vocab chips */}
      <div className="flex flex-wrap gap-1.5 mb-4 pb-3 border-b border-stone-200">
        {selected.map((e) => (
          <span key={e.id} className="text-xs px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-sm">
            {e.starred ? '★ ' : ''}{e.term}
          </span>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-4 py-3 rounded-sm text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-[#1C1917] text-white'
                  : 'review-message bg-white border border-stone-200 text-[#1C1917]'
              }`}
              {...(msg.role === 'assistant'
                ? { dangerouslySetInnerHTML: { __html: msg.content } }
                : { children: msg.content })}
            />
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="px-4 py-3 bg-white border border-stone-200 rounded-sm">
              <Loader2 size={16} className="animate-spin text-stone-400" />
            </div>
          </div>
        )}

        {error && (
          <div className="text-red-600 text-sm bg-red-50 border border-red-200 px-4 py-2 rounded-sm">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="mt-4 flex gap-2 items-end border-t border-stone-200 pt-4">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Reply to Claude... (Enter to send, Shift+Enter for newline)"
          rows={2}
          className="flex-1 px-3 py-2 border border-stone-300 rounded-sm bg-white text-sm text-[#1C1917] resize-none focus:outline-none focus:border-amber-500 transition-colors"
        />
        <div className="flex flex-col gap-2">
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="p-2.5 bg-[#D97706] text-white rounded-sm hover:bg-amber-700 transition-colors disabled:opacity-40"
            title="Send"
          >
            <Send size={16} />
          </button>
          <button
            onClick={endSession}
            className="p-2.5 bg-stone-200 text-stone-600 rounded-sm hover:bg-stone-300 transition-colors"
            title="End session"
          >
            <Square size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
