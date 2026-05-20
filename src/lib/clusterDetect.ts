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
  const apiKey = getApiKey();
  console.log('[Cluster] Calling DeepSeek API, key present:', !!apiKey);
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
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
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[Cluster] DeepSeek API error', res.status, body);
    throw new Error(`API ${res.status}: ${body}`);
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
  console.log('[Cluster] Starting detection for new term:', newEntry.term);
  console.log('[Cluster] Existing entries to scan:', existingEntries.length);

  if (existingEntries.length === 0) {
    console.log('[Cluster] No existing entries — skipping');
    return null;
  }

  const system = `You are a lexical grouping tool. Your job is to find words that come from the same root — different grammatical forms of the same base word.

Examples of what SHOULD be clustered:
- advance, advanced, advancement, advancing, unadvanced
- decide, decision, decisive, decisively, indecisive
- beauty, beautiful, beautifully, beautify, beautification
- depend, dependent, dependence, independence, independently
- humiliate, humiliating, humiliated, humiliation

The rule is simple: if you remove prefixes and suffixes, do the words share the same core root? If yes → same cluster.

Common suffixes to look past: -ed, -ing, -ion, -tion, -ment, -ness, -ly, -ful, -less, -ity, -ive, -al, -ance, -ence, -er, -est
Common prefixes to look past: un-, in-, im-, dis-, re-, pre-, over-

Return ONLY a JSON object, no explanation, no markdown:
{ "related_ids": ["uuid1"], "root": "advance", "cluster_name": "advance" }

If no related entries found, return: { "related_ids": [], "root": null, "cluster_name": null }
Never return null at the top level. Never add commentary.`;

  const user = `New term: "${newEntry.term}"
Existing terms (id + term): ${JSON.stringify(existingEntries.map((e) => ({ id: e.id, term: e.term })))}`;

  try {
    const raw = await callDeepSeek(system, user);
    console.log('[Cluster] AI response:', raw);

    const result = parseJSON<{
      related_ids: string[];
      root: string | null;
      cluster_name: string | null;
    }>(raw);
    console.log('[Cluster] Parsed result:', result);

    if (!result || result.related_ids.length === 0 || !result.cluster_name) {
      console.log('[Cluster] No related entries found for:', newEntry.term);
      return null;
    }

    console.log('[Cluster] Related IDs found:', result.related_ids);

    // Find entries that matched
    const relatedEntries = existingEntries.filter((e) => result.related_ids.includes(e.id));
    const allEntryIds = [...relatedEntries.map((e) => e.id), newEntry.id];
    console.log('[Cluster] Matched entries:', relatedEntries.map((e) => e.term));

    // Check if any related entry already belongs to an existing cluster
    const existingCluster = store.clusters.find((c) =>
      relatedEntries.some((e) => e.cluster_id === c.id)
    );

    if (existingCluster) {
      console.log('[Cluster] Joining existing cluster:', existingCluster.cluster_name, existingCluster.id);
      await store.updateEntryCluster([newEntry.id], existingCluster.id);
      console.log('[Cluster] Joined existing cluster successfully');
      return existingCluster.cluster_name;
    }

    // Create a new cluster
    console.log('[Cluster] Creating new cluster:', result.cluster_name);
    const clusterId = await store.addCluster({
      user_id: store.userId,
      cluster_name: result.cluster_name,
      root: result.root ?? result.cluster_name,
      shared_meaning: null,
      key_difference: null,
    });
    console.log('[Cluster] Cluster created with ID:', clusterId);

    await store.updateEntryCluster(allEntryIds, clusterId);
    console.log('[Cluster] Entry cluster_ids updated for entries:', allEntryIds);

    // Generate meaning in background (non-blocking)
    const meaningEntries = [newEntry, ...relatedEntries].map((e) => ({
      term: e.term,
      definition: e.english_definition,
    }));
    generateMeaning(meaningEntries).then((meaning) => {
      if (meaning) store.updateClusterMeaning(clusterId, meaning.shared, meaning.difference);
    });

    return result.cluster_name;
  } catch (e) {
    console.error('[Cluster] Detection error for term', newEntry.term, ':', e);
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
  console.log('[Cluster] Starting bulk scan for', unclusteredEntries.length, 'entries:', unclusteredEntries.map((e) => e.term));
  if (unclusteredEntries.length === 0) return 0;

  const system = `You are a lexical grouping tool. Your job is to find words that come from the same root — different grammatical forms of the same base word.

Examples of what SHOULD be clustered:
- advance, advanced, advancement, advancing, unadvanced
- decide, decision, decisive, decisively, indecisive
- beauty, beautiful, beautifully, beautify, beautification
- depend, dependent, dependence, independence, independently
- humiliate, humiliating, humiliated, humiliation

The rule is simple: if you remove prefixes and suffixes, do the words share the same core root? If yes → same cluster.

Common suffixes to look past: -ed, -ing, -ion, -tion, -ment, -ness, -ly, -ful, -less, -ity, -ive, -al, -ance, -ence, -er, -est
Common prefixes to look past: un-, in-, im-, dis-, re-, pre-, over-

A cluster must have at least 2 members. Omit words that share no root with any other word.

Return ONLY a valid JSON array, no explanation, no markdown:
[{ "root": "advance", "cluster_name": "advance", "member_ids": ["uuid1", "uuid2"] }]

If truly no words share a root, return an empty array: []
Never return null. Never add commentary.`;

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
    console.log('[Cluster] Sending batch', b + 1, 'to AI:', batch.map((e) => e.term));

    try {
      const raw = await callDeepSeek(system, user);
      console.log('[Cluster] Batch', b + 1, 'AI response:', raw);

      const groups = parseJSON<{ root: string; cluster_name: string; member_ids: string[] }[]>(raw);
      console.log('[Cluster] Batch', b + 1, 'groups detected:', groups);

      if (!Array.isArray(groups)) {
        console.warn('[Cluster] Batch', b + 1, '— AI response was not an array, skipping');
        continue;
      }

      for (const group of groups) {
        if (!group.member_ids || group.member_ids.length < 2) {
          console.log('[Cluster] Skipping group (< 2 members):', group);
          continue;
        }

        try {
          console.log('[Cluster] Creating cluster:', group.cluster_name, 'for IDs:', group.member_ids);
          const clusterId = await store.addCluster({
            user_id: store.userId,
            cluster_name: group.cluster_name ?? group.root,
            root: group.root,
            shared_meaning: null,
            key_difference: null,
          });
          console.log('[Cluster] Cluster created:', group.cluster_name, '→ ID:', clusterId);

          await store.updateEntryCluster(group.member_ids, clusterId);
          console.log('[Cluster] Entry cluster_ids updated for cluster:', group.cluster_name);

          totalClusters++;

          // Generate meaning async
          const memberEntries = unclusteredEntries
            .filter((e) => group.member_ids.includes(e.id))
            .map((e) => ({ term: e.term, definition: e.english_definition }));
          generateMeaning(memberEntries).then((meaning) => {
            if (meaning) store.updateClusterMeaning(clusterId, meaning.shared, meaning.difference);
          });
        } catch (e) {
          console.error('[Cluster] Failed to create cluster', group.cluster_name, ':', e);
        }
      }
    } catch (e) {
      console.error('[Cluster] Batch', b + 1, 'failed:', e);
    }
  }

  console.log('[Cluster] Bulk scan complete. Total clusters created:', totalClusters);
  return totalClusters;
}
