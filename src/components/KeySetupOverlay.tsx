import { useState } from 'react';
import { saveApiKey } from '../lib/apiKey';
import { Eye, EyeOff } from 'lucide-react';

interface Props {
  onDone: (key: string) => void;
}

export function KeySetupOverlay({ onDone }: Props) {
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    saveApiKey(trimmed);
    onDone(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#F8F5EE] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-[#1C1917] rounded-sm flex items-center justify-center">
            <span className="text-white text-sm font-bold font-['Playfair_Display']">L</span>
          </div>
          <div>
            <h1 className="font-['Playfair_Display'] text-2xl font-bold text-[#1C1917] leading-none">
              LexiLog
            </h1>
            <p className="text-[10px] text-stone-400 tracking-widest uppercase mt-0.5">
              Vocabulary Companion
            </p>
          </div>
        </div>

        <h2 className="font-['Playfair_Display'] text-xl font-semibold text-[#1C1917] mb-2">
          Enter your DeepSeek API key
        </h2>
        <p className="text-sm text-stone-500 mb-6 leading-relaxed">
          LexiLog uses DeepSeek to auto-generate vocabulary entries and power
          conversation practice. Your key is stored only in this browser and
          never leaves your device.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type={visible ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-..."
              autoFocus
              className="w-full px-4 py-3 pr-11 border-2 border-stone-300 rounded-sm bg-white text-[#1C1917] text-sm font-mono focus:outline-none focus:border-[#D97706] transition-colors"
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors"
            >
              {visible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <button
            type="submit"
            disabled={!key.trim()}
            className="w-full py-3 bg-[#1C1917] text-white text-sm font-semibold rounded-sm hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start using LexiLog
          </button>
        </form>

        <p className="mt-4 text-xs text-stone-400 text-center">
          You can update your key later via the key icon in the header.
        </p>
      </div>
    </div>
  );
}
