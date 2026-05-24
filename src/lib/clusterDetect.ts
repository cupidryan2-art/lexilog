/**
 * Cluster detection — deterministic morphological approach. Zero AI calls for detection.
 *
 *  1. compromise NLP: normalises inflected forms to base (running→run, advanced→advance)
 *  2. Prefix matching: catches advance / advanced / advancement directly
 *
 * AI is used ONLY to generate the "shared meaning / key difference" summary text
 * after a cluster is created — one-time, non-blocking, best-effort.
 */
import nlp from 'compromise';
import type { VocabEntry, WordCluster } from '../types';
import { getApiKey, DEEPSEEK_URL } from './apiKey';

// ─── Store interface ──────────────────────────────────────────────────────────

interface ClusterStoreOps {
  clusters: WordCluster[];
  userId: string;
  addCluster: (data: Omit<WordCluster, 'id' | 'created_at'>) => Promise<string>;
  updateClusterMeaning: (clusterId: string, shared: string, diff: string) => Promise<void>;
  updateEntryCluster: (ids: string[], clusterId: string | null) => Promise<void>;
}

// ─── NLP root normalisation ───────────────────────────────────────────────────

/**
 * Returns the base/root form of a single word using compromise.
 * "advanced" → "advance", "running" → "run", "decisions" → "decision"
 */
function getWordRoot(word: string): string {
  const w = word.toLowerCase().trim();
  if (w.length < 3) return w;

  const doc = nlp(w);

  // Verb infinitive has priority: catches -ed, -ing, -s verb forms
  const verbInf = doc.verbs().toInfinitive().text().toLowerCase().trim();
  if (verbInf && verbInf !== w && verbInf.length >= 3) return verbInf;

  // Singular noun: catches plurals
  const nounSing = doc.nouns().toSingular().text().toLowerCase().trim();
  if (nounSing && nounSing.length >= 3) return nounSing;

  return w;
}

// ─── Pairwise relatedness ─────────────────────────────────────────────────────

/**
 * Returns true when termA and termB belong to the same word family.
 *
 * Two checks (either is sufficient):
 *  a) Prefix match — shorter word is a prefix of the longer word (≥4 chars).
 *     Catches: advance/advanced/advancement, humiliate/humiliating/humiliation
 *  b) Same NLP root — compromise reduces both to the same infinitive/singular.
 *     Catches: run/running/ran, decision/decisions
 */
function areRelated(termA: string, termB: string): boolean {
  const a = termA.toLowerCase().trim();
  const b = termB.toLowerCase().trim();
  if (a === b) return false;

  const shorter = a.length <= b.length ? a : b;
  const longer  = a.length <= b.length ? b : a;

  // (a) Prefix — require ≥4 chars so "is/island", "am/ample" don't match
  if (shorter.length >= 4 && longer.startsWith(shorter)) return true;

  // (b) Same NLP root — require root ≥4 chars for the same reason
  const rootA = getWordRoot(a);
  const rootB = getWordRoot(b);
  if (rootA.length >= 4 && rootA === rootB) return true;

  return false;
}

// ─── Union-find ───────────────────────────────────────────────────────────────

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p !== x) this.parent.set(x, this.find(p));
    return this.parent.get(x)!;
  }

  union(x: string, y: string): void {
    const px = this.find(x);
    const py = this.find(y);
    if (px !== py) this.parent.set(px, py);
  }

  /** Returns connected components with ≥2 members. */
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

// ─── Cluster building (synchronous, no API calls) ────────────────────────────

interface ClusterGroup {
  root: string;
  members: VocabEntry[];
}

/**
 * Groups entries into word-family clusters using purely local logic.
 * Single words only — sentence patterns and multi-word collocations are skipped.
 */
function buildClusters(entries: VocabEntry[]): ClusterGroup[] {
  // Only single-word entries are eligible for morphological clustering
  const candidates = entries.filter((e) => {
    if (e.category === 'sentence_pattern') return false;
    if (e.term.trim().includes(' ')) return false; // phrases/collocations skipped
    return true;
  });

  // Log root map for debugging
  const rootMap: Record<string, string[]> = {};
  for (const e of candidates) {
    const r = getWordRoot(e.term);
    if (!rootMap[r]) rootMap[r] = [];
    rootMap[r].push(e.term);
  }
  console.log('[Cluster] Root map:', rootMap);

  // Pairwise relatedness → union-find groups
  const uf = new UnionFind();
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (areRelated(candidates[i].term, candidates[j].term)) {
        uf.union(candidates[i].id, candidates[j].id);
        console.log('[Cluster] Related:', candidates[i].term, '↔', candidates[j].term);
      }
    }
  }

  const groups = uf.getGroups();
  const clusters: ClusterGroup[] = groups.map((ids) => {
    const members = candidates.filter((e) => ids.includes(e.id));
    // Use the shortest term as the cluster root name (most likely the base form)
    const root = members.map((e) => e.term).sort((a, b) => a.length - b.length)[0];
    return { root, members };
  });

  console.log('[Cluster] Clusters found:', clusters.length);
  clusters.forEach((c) =>
    console.log(`  "${c.root}": ${c.members.map((m) => m.term).join(', ')}`)
  );

  return clusters;
}

// ─── AI: shared meaning generation (one-time per cluster) ────────────────────

async function callDeepSeek(system: string, user: string): Promise<string> {
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 300,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? '';
}

function parseJSON<T>(text: string): T | null {
  try {
    return JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()) as T;
  } catch {
    return null;
  }
}

async function generateMeaning(
  entries: { term: string; definition: string }[]
): Promise<{ shared: string; difference: string } | null> {
  const list = entries.map((e) => `"${e.term}": ${e.definition}`).join('\n');
  const system = `You are a lexicographer. Given related words, describe their relationship concisely.
Return ONLY valid JSON: { "shared": "<2 sentences on what they share>", "difference": "<2 sentences on the key distinction>" }`;
  try {
    const raw = await callDeepSeek(system, `Words:\n${list}`);
    return parseJSON<{ shared: string; difference: string }>(raw);
  } catch {
    return null;
  }
}

// ─── Single-entry detection ───────────────────────────────────────────────────

/**
 * After a new entry is saved, check if it belongs to a word family with any
 * existing entry. Returns the cluster_name if grouped, null otherwise.
 * No AI call — purely morphological.
 */
export async function detectAndCluster(
  newEntry: VocabEntry,
  existingEntries: VocabEntry[],
  store: ClusterStoreOps
): Promise<string | null> {
  console.log('[Cluster] Checking new entry:', newEntry.term);

  // Skip phrases and sentence patterns
  if (newEntry.category === 'sentence_pattern') return null;
  if (newEntry.term.trim().includes(' ')) return null;

  const related = existingEntries.filter((e) => {
    if (e.category === 'sentence_pattern') return false;
    if (e.term.trim().includes(' ')) return false;
    const result = areRelated(newEntry.term, e.term);
    if (result) console.log('[Cluster] Related:', newEntry.term, '↔', e.term);
    return result;
  });

  console.log('[Cluster] Related entries found:', related.map((e) => e.term));
  if (related.length === 0) return null;

  // Check if any related entry already belongs to a cluster → join it
  const existingCluster = store.clusters.find((c) =>
    related.some((e) => e.cluster_id === c.id)
  );

  if (existingCluster) {
    console.log('[Cluster] Joining existing cluster:', existingCluster.cluster_name);
    await store.updateEntryCluster([newEntry.id], existingCluster.id);
    return existingCluster.cluster_name;
  }

  // Create new cluster
  const allMembers = [newEntry, ...related];
  const root = allMembers.map((e) => e.term).sort((a, b) => a.length - b.length)[0];

  console.log('[Cluster] Creating new cluster, root:', root);
  const clusterId = await store.addCluster({
    user_id: store.userId,
    cluster_name: root,
    root,
    shared_meaning: null,
    key_difference: null,
  });

  await store.updateEntryCluster(allMembers.map((e) => e.id), clusterId);
  console.log('[Cluster] Cluster created:', clusterId, '→', allMembers.map((e) => e.term));

  // Generate meaning summary async (non-blocking, best-effort)
  generateMeaning(
    allMembers.map((e) => ({ term: e.term, definition: e.english_definition }))
  ).then((meaning) => {
    if (meaning) store.updateClusterMeaning(clusterId, meaning.shared, meaning.difference);
  });

  return root;
}

// ─── Bulk scan ────────────────────────────────────────────────────────────────

/**
 * Scan entries and create word-family clusters. No AI for detection — runs
 * instantly. AI is called only for the shared/difference text (async, per cluster).
 * Returns the number of clusters created.
 */
export async function bulkScan(
  entries: VocabEntry[],
  store: ClusterStoreOps,
  onProgress: (msg: string) => void
): Promise<number> {
  console.log('[Cluster] Bulk scan started for', entries.length, 'entries:',
    entries.map((e) => e.term));

  const clusters = buildClusters(entries);

  if (clusters.length === 0) {
    console.log('[Cluster] No word families found');
    return 0;
  }

  let total = 0;

  for (const cluster of clusters) {
    const preview = cluster.members.map((m) => m.term).join(', ');
    onProgress(`Creating word family: "${cluster.root}" (${preview})`);
    console.log('[Cluster] Creating cluster:', cluster.root, '→', preview);

    try {
      const clusterId = await store.addCluster({
        user_id: store.userId,
        cluster_name: cluster.root,
        root: cluster.root,
        shared_meaning: null,
        key_difference: null,
      });

      await store.updateEntryCluster(cluster.members.map((m) => m.id), clusterId);
      console.log('[Cluster] Created:', cluster.root, 'ID:', clusterId);
      total++;

      // Generate shared meaning async — non-blocking
      generateMeaning(
        cluster.members.map((m) => ({ term: m.term, definition: m.english_definition }))
      ).then((meaning) => {
        if (meaning) store.updateClusterMeaning(clusterId, meaning.shared, meaning.difference);
      });
    } catch (e) {
      console.error('[Cluster] Failed to create cluster', cluster.root, ':', e);
    }
  }

  console.log('[Cluster] Bulk scan complete. Clusters created:', total);
  return total;
}
