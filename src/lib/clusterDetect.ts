/**
 * Cluster detection — two-step approach:
 *  1. Client-side rule-based pre-filter: substring containment + Levenshtein distance
 *     finds candidate pairs without any AI calls.
 *  2. AI yes/no confirmation per pair: a single focused question the model cannot fumble.
 *  3. Union-find groups confirmed pairs into clusters, saved to Supabase.
 */
import type { VocabEntry, WordCluster } from '../types';
import { getApiKey, DEEPSEEK_URL } from './apiKey';

// ─── Store interface ─────────────────────────────────────────────────────────

interface ClusterStoreOps {
  clusters: WordCluster[];
  userId: string;
  addCluster: (data: Omit<WordCluster, 'id' | 'created_at'>) => Promise<string>;
  updateClusterMeaning: (clusterId: string, shared: string, diff: string) => Promise<void>;
  updateEntryCluster: (ids: string[], clusterId: string | null) => Promise<void>;
}

// ─── DeepSeek helper ─────────────────────────────────────────────────────────

async function callDeepSeek(system: string, user: string, maxTokens = 100): Promise<string> {
  const apiKey = getApiKey();
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DeepSeek ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? '';
}

function parseJSON<T>(text: string): T | null {
  try {
    const clean = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(clean) as T;
  } catch {
    return null;
  }
}

// ─── Client-side pre-filter ──────────────────────────────────────────────────

function normalize(term: string): string {
  return term.toLowerCase().replace(/\s+/g, '');
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

/**
 * Returns candidate pairs where one term contains the other as a substring,
 * OR the terms are within Levenshtein distance 3 of each other.
 * These are cheap to compute and filter out the vast majority of unrelated pairs
 * before any AI calls are made.
 */
function findCandidatePairs(entries: VocabEntry[]): [VocabEntry, VocabEntry][] {
  const pairs: [VocabEntry, VocabEntry][] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = normalize(entries[i].term);
      const b = normalize(entries[j].term);
      if (a.includes(b) || b.includes(a) || levenshtein(a, b) <= 3) {
        pairs.push([entries[i], entries[j]]);
      }
    }
  }
  return pairs;
}

// ─── AI yes/no confirmation ───────────────────────────────────────────────────

async function confirmPair(termA: string, termB: string): Promise<boolean> {
  const system = `Answer with valid JSON only. No explanation.
Are these two English words/phrases from the same word family (sharing the same root, just different grammatical forms)?
Examples of SAME family: advance/advanced, decide/decision, beauty/beautiful, depend/dependent
Examples of DIFFERENT family: advance/cancel, beautiful/handsome, decision/opinion

Respond with exactly one of:
{ "same_family": true }
{ "same_family": false }`;

  const user = `Word 1: "${termA}"  Word 2: "${termB}"`;

  try {
    const raw = await callDeepSeek(system, user, 30);
    console.log('[Cluster AI raw response]:', raw);
    const result = parseJSON<{ same_family: boolean }>(raw);
    return result?.same_family === true;
  } catch (e) {
    console.error('[Cluster] confirmPair error for', termA, '/', termB, ':', e);
    return false;
  }
}

// ─── Union-find (groups confirmed pairs into clusters) ────────────────────────

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p !== x) this.parent.set(x, this.find(p)); // path compression
    return this.parent.get(x)!;
  }

  union(x: string, y: string): void {
    const px = this.find(x);
    const py = this.find(y);
    if (px !== py) this.parent.set(px, py);
  }

  /** Returns groups of IDs that were connected via union(). Groups with 1 member are omitted. */
  getGroups(): string[][] {
    const buckets = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      if (!buckets.has(root)) buckets.set(root, []);
      buckets.get(root)!.push(id);
    }
    return [...buckets.values()].filter((g) => g.length >= 2);
  }
}

// ─── Shared meaning generation ────────────────────────────────────────────────

async function generateMeaning(
  entries: { term: string; definition: string }[]
): Promise<{ shared: string; difference: string } | null> {
  const list = entries.map((e) => `"${e.term}": ${e.definition}`).join('\n');
  const system = `You are a lexicographer. Given related words, describe their relationship concisely.
Return ONLY valid JSON with no extra text:
{ "shared": "<2 sentences on what they share semantically>", "difference": "<2 sentences on the key distinction>" }`;
  try {
    const raw = await callDeepSeek(system, `Words:\n${list}`, 300);
    return parseJSON<{ shared: string; difference: string }>(raw);
  } catch {
    return null;
  }
}

// ─── Single-entry detection ──────────────────────────────────────────────────

/**
 * After a new entry is saved, check if it belongs to a word family with any
 * existing entry. Returns the cluster_name if grouped, null otherwise.
 */
export async function detectAndCluster(
  newEntry: VocabEntry,
  existingEntries: VocabEntry[],
  store: ClusterStoreOps
): Promise<string | null> {
  console.log('[Cluster] Starting detection for new term:', newEntry.term);
  console.log('[Cluster] Existing entries to scan:', existingEntries.length);

  if (existingEntries.length === 0) return null;

  // Step 1 — Client-side filter
  const candidates = existingEntries.filter((existing) => {
    const a = normalize(newEntry.term);
    const b = normalize(existing.term);
    return a.includes(b) || b.includes(a) || levenshtein(a, b) <= 3;
  });

  console.log('[Cluster] Candidate matches for', newEntry.term, ':',
    candidates.map((e) => e.term));

  if (candidates.length === 0) {
    console.log('[Cluster] No candidates — skipping AI call');
    return null;
  }

  // Step 2 — AI confirmation per candidate
  const confirmed: VocabEntry[] = [];
  for (const candidate of candidates) {
    console.log('[Cluster] Checking pair:', newEntry.term, 'vs', candidate.term);
    const isRelated = await confirmPair(newEntry.term, candidate.term);
    console.log('[Cluster] Pair result:', newEntry.term, 'vs', candidate.term, '→', isRelated);
    if (isRelated) confirmed.push(candidate);
  }

  if (confirmed.length === 0) {
    console.log('[Cluster] AI rejected all candidates for', newEntry.term);
    return null;
  }

  console.log('[Cluster] Confirmed related entries:', confirmed.map((e) => e.term));

  // Step 3 — Join existing cluster or create new one
  const existingCluster = store.clusters.find((c) =>
    confirmed.some((e) => e.cluster_id === c.id)
  );

  if (existingCluster) {
    console.log('[Cluster] Joining existing cluster:', existingCluster.cluster_name);
    await store.updateEntryCluster([newEntry.id], existingCluster.id);
    return existingCluster.cluster_name;
  }

  const allMembers = [newEntry, ...confirmed];
  const root = allMembers.map((e) => e.term).sort((a, b) => a.length - b.length)[0];

  console.log('[Cluster] Creating new cluster with root:', root);
  const clusterId = await store.addCluster({
    user_id: store.userId,
    cluster_name: root,
    root,
    shared_meaning: null,
    key_difference: null,
  });

  await store.updateEntryCluster(allMembers.map((e) => e.id), clusterId);
  console.log('[Cluster] Cluster created:', clusterId, 'for', allMembers.map((e) => e.term));

  generateMeaning(allMembers.map((e) => ({ term: e.term, definition: e.english_definition }))).then(
    (meaning) => {
      if (meaning) store.updateClusterMeaning(clusterId, meaning.shared, meaning.difference);
    }
  );

  return root;
}

// ─── Bulk scan ────────────────────────────────────────────────────────────────

/**
 * Scan all (unclustered) entries and group them into word family clusters.
 * Returns the number of clusters created.
 */
export async function bulkScan(
  entries: VocabEntry[],
  store: ClusterStoreOps,
  onProgress: (msg: string) => void
): Promise<number> {
  console.log('[Cluster] Bulk scan started for', entries.length, 'entries:',
    entries.map((e) => e.term));

  if (entries.length === 0) return 0;

  // Step 1 — Find all candidate pairs (no AI yet)
  const pairs = findCandidatePairs(entries);
  console.log('[Cluster] Candidate pairs found:', pairs.length,
    pairs.map(([a, b]) => `${a.term}/${b.term}`));

  if (pairs.length === 0) {
    console.log('[Cluster] No candidates — done');
    return 0;
  }

  // Step 2 — Confirm each pair with AI
  const uf = new UnionFind();

  for (let i = 0; i < pairs.length; i++) {
    const [entryA, entryB] = pairs[i];
    onProgress(`Checking: "${entryA.term}" ↔ "${entryB.term}" (${i + 1}/${pairs.length})`);
    console.log('[Cluster] Checking pair:', entryA.term, 'vs', entryB.term);

    const confirmed = await confirmPair(entryA.term, entryB.term);
    console.log('[Cluster] Pair result:', entryA.term, 'vs', entryB.term, '→', confirmed);

    if (confirmed) {
      uf.union(entryA.id, entryB.id);
      console.log('[Cluster] Pair confirmed — joined in union-find');
    }
  }

  // Step 3 — Build clusters from connected components
  const groups = uf.getGroups();
  console.log('[Cluster] Connected groups:', groups.length,
    groups.map((g) => g.map((id) => entries.find((e) => e.id === id)?.term)));

  let totalClusters = 0;

  for (const memberIds of groups) {
    const memberEntries = entries.filter((e) => memberIds.includes(e.id));
    const root = memberEntries.map((e) => e.term).sort((a, b) => a.length - b.length)[0];

    console.log('[Cluster] Creating cluster:', root, 'for', memberEntries.map((e) => e.term));
    try {
      const clusterId = await store.addCluster({
        user_id: store.userId,
        cluster_name: root,
        root,
        shared_meaning: null,
        key_difference: null,
      });
      console.log('[Cluster] Cluster created:', clusterId);

      await store.updateEntryCluster(memberIds, clusterId);
      console.log('[Cluster] Entry cluster_ids updated');

      totalClusters++;

      generateMeaning(memberEntries.map((e) => ({ term: e.term, definition: e.english_definition }))).then(
        (meaning) => {
          if (meaning) store.updateClusterMeaning(clusterId, meaning.shared, meaning.difference);
        }
      );
    } catch (e) {
      console.error('[Cluster] Failed to create cluster for', root, ':', e);
    }
  }

  console.log('[Cluster] Bulk scan complete. Clusters created:', totalClusters);
  return totalClusters;
}
