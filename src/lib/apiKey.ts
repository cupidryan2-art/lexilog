export const DEEPSEEK_API_KEY_STORAGE = 'lexilog_deepseek_key';
export const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

export function getApiKey(): string {
  try {
    return localStorage.getItem(DEEPSEEK_API_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function saveApiKey(key: string): void {
  try {
    localStorage.setItem(DEEPSEEK_API_KEY_STORAGE, key.trim());
  } catch {}
}
