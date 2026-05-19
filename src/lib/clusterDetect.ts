/**
 * Cluster detection logic — all AI calls are fire-and-forget background operations.
 * Never throws; returns null / 0 on any failure.
 */
import type { VocabEntry, WordCluster } from '../types';
import { getApiKey, DEEPSEEK_URL } from './apiKey';

interface ClusterStoreOps {
  clusters: WordCluster[];
  userId: string;
  addCluster: (data: Omit<WordCluster, 'id' | 'created_at'>) => Promise<string>;
  updateClusterMeaning: (clusterId: string, shared: string, diff: string) => Promise<void>;
  updateEntryCluster: (ids: string[], clusterId: string | null) => Promise<void>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function callDeepSeek(system: string, user: string): Promise<string> {
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 800,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
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

/** Generate shared_meaning and key_difference for a set of clustered entries. */
async function generateMeaning(
  entries: { term: string; definition: string }[]
): Promise<{ shared: string; difference: string } | null> {
  const list = entries.map((e) => `"${e.term}": ${e.definition}`).join('\n');
  const system = `You are a lexicographer. Given related words, describe their relationship concisely.
Return ONLY valid JSON with no extra text:
{ "shared": "<2 sentences on what they share semantically>", "difference": "<2 sentences on the key distinction>" }`;
  const user = `Words:\n${list}`;
  try {
    const raw = await callDeepSeek(system, user);
    return parseJSON<{ shared: string; difference: string }>(raw);
  } catch {
    return null;
  }
}

// ─── Single-entry detection ──────────────────────────────────────────────────

/**
 * After a new entry is saved, check if any existing entries share its linguistic root.
 * Returns the cluster_name if a cluster was created/joined, or null.
 */
export async function detectAndCluster(
  newEntry: VocabEntry,
  existingEntries: VocabEntry[], // must NOT include newEntry
  store: ClusterStoreOps
): Promise<string | null> {
  if (existingEntries.length === 0) return null;

  const system = `You are a lexical analysis tool. Given a new vocabulary term and a list of existing terms, identify which existing terms are linguistically related to the new one.

"Related" means they share the same root/stem — e.g.:
- advance / advanced / advancement / advancing
- decide / decision / decisive / indecisive
- beauty / beautiful / beautifully / beautify

Do NOT cluster words that are merely thematically related (e.g. "rain" and "umbrella" are NOT a cluster).

Return ONLY a JSON object, no extra text:
{ "related_ids": ["uuid1"], "root": "advance", "cluster_name": "advance" }

If no related entries found, return: { "related_ids": [], "root": null, "cluster_name": null }`;

  const user = `New term: "${newEntry.term}"
Existing terms (id + term): ${JSON.stringify(existingEntries.map((e) => ({ id: e.id, term: e.term })))}`;

  try {
    const raw = await callDeepSeek(system, user);
    const result = parseJSON<{
      related_ids: string[];
      root: string | null;
      cluster_name: string | null;
    }>(raw);

    if (!result || result.related_ids.length === 0 || !result.cluster_name) return null;

    // Find entries that matched
    const relatedEntries = existingEntries.filter((e) => result.related_ids.includes(e.id));
    const allEntryIds = [...relatedEntries.map((e) => e.id), newEntry.id];

    // Check if any related entry already belongs to an existing cluster
    const existingCluster = store.clusters.find((c) =>
      relatedEntries.some((e) => e.cluster_id === c.id)
    );

    if (existingCluster) {
      // Join the existing cluster
      await store.updateEntryCluster([newEntry.id], existingCluster.id);
      return existingCluster.cluster_name;
    }

    // Create a new cluster
    const clusterId = await store.addCluster({
      user_id: store.userId,
      cluster_name: result.cluster_name,
      root: result.root ?? result.cluster_name,
      shared_meaning: null,
      key_difference: null,
    });
    await store.updateEntryCluster(allEntryIds, clusterId);

    // Generate meaning in background (non-blocking)
    const meaningEntries = [newEntry, ...relatedEntries].map((e) => ({
      term: e.term,
      definition: e.english_definition,
    }));
    generateMeaning(meaningEntries).then((meaning) => {
      if (meaning) store.updateClusterMeaning(clusterId, meaning.shared, meaning.difference);
    });

    return result.cluster_name;
  } catch {
    return null;
  }
}

// ─── Bulk scan ───────────────────────────────────────────────────────────────

const BATCH_SIZE = 50;

/**
 * Scan all unclustered entries and group them into word family clusters.
 * Returns the number of clusters created.
 */
export async function bulkScan(
  unclusteredEntries: VocabEntry[],
  store: ClusterStoreOps,
  onProgress: (msg: string) => void
): Promise<number> {
  if (unclusteredEntries.length === 0) return 0;

  const system = `You are a lexical analysis tool. Group the following vocabulary terms into word family clusters based on shared linguistic root/stem.

Rules:
- Only group words that share the same root (e.g. advance/advanced/advancement)
- Do NOT group by theme or topic
- A cluster must have at least 2 members
- Omit words that don't belong to any cluster

Return ONLY a JSON array, no extra text:
[{ "root": "advance", "cluster_name": "advance", "member_ids": ["uuid1", "uuid2"] }]

If no clusters found, return: []`;

  const batches: VocabEntry[][] = [];
  for (let i = 0; i < unclusteredEntries.length; i += BATCH_SIZE) {
    batches.push(unclusteredEntries.slice(i, i + BATCH_SIZE));
  }

  let totalClusters = 0;

  for (let b = 0; b < batches.length; b++) {
    if (batches.length > 1) {
      onProgress(`Scanning batch ${b + 1} of ${batches.length}…`);
    }

    const batch = batches[b];
    const user = JSON.stringify(batch.map((e) => ({ id: e.id, term: e.term })));

    try {
      const raw = await callDeepSeek(system, user);
      const groups = parseJSON<{ root: string; cluster_name: string; member_ids: string[] }[]>(raw);
      if (!Array.isArray(groups)) continue;

      for (const group of groups) {
        if (!group.member_ids || group.member_ids.length < 2) continue;

        try {
          const clusterId = await store.addCluster({
            user_id: store.userId,
            cluster_name: group.cluster_name ?? group.root,
            root: group.root,
            shared_meaning: null,
            key_difference: null,
          });
          await store.updateEntryCluster(group.member_ids, clusterId);
          totalClusters++;

          // Generate meaning async
          const memberEntries = unclusteredEntries
            .filter((e) => group.member_ids.includes(e.id))
            .map((e) => ({ term: e.term, definition: e.english_definition }));
          generateMeaning(memberEntries).then((meaning) => {
            if (meaning) store.updateClusterMeaning(clusterId, meaning.shared, meaning.difference);
          });
        } catch {
          // skip this group, continue
        }
      }
    } catch {
      // skip this batch, continue
    }
  }

  return totalClusters;
}
