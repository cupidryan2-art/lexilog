import { useState, useMemo, useEffect, useRef } from 'react';
import type { VocabEntry, WordCluster, SortOption, FilterCategory } from '../types';
import { EntryCard } from './EntryCard';
import { ClusterCard } from './ClusterCard';
import { QuickAdd } from './QuickAdd';
import { Search, SlidersHorizontal, RefreshCw } from 'lucide-react';
import { detectAndCluster, bulkScan } from '../lib/clusterDetect';
import { supabase } from '../lib/supabase';

const SCAN_KEY = 'cluster_scan_v1_done';

type DisplayItem =
  | { type: 'solo'; entry: VocabEntry }
  | { type: 'cluster'; cluster: WordCluster; entries: VocabEntry[] };

interface Props {
  userId: string;
  entries: VocabEntry[];
  clusters: WordCluster[];
  onAdd: (data: Omit<VocabEntry, 'id' | 'date_added' | 'starred' | 'review_count'>) => Promise<string>;
  onEdit: (entry: VocabEntry) => void;
  onDelete: (id: string) => void;
  onToggleStar: (id: string) => void;
  onStarBatch: (ids: string[], starred: boolean) => void;
  onUnlinkCluster: (clusterId: string) => Promise<void>;
  onClusterUpdate: () => Promise<void>;
  // Cluster store ops passed through for detection
  addCluster: (data: Omit<WordCluster, 'id' | 'created_at'>) => Promise<string>;
  updateClusterMeaning: (id: string, shared: string, diff: string) => Promise<void>;
  updateEntryCluster: (ids: string[], clusterId: string | null) => Promise<void>;
}

export function VocabNotebook({
  userId,
  entries,
  clusters,
  onAdd,
  onEdit,
  onDelete,
  onToggleStar,
  onStarBatch,
  onUnlinkCluster,
  onClusterUpdate,
  addCluster,
  updateClusterMeaning,
  updateEntryCluster,
}: Props) {
  const [query, setQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('all');
  const [sort, setSort] = useState<SortOption>('starred');
  const [showFilters, setShowFilters] = useState(false);
  const [newEntryId, setNewEntryId] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  // Scan banner
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [scanDone, setScanDone] = useState(false);
  const scanRunning = useRef(false);

  const storeOps = useMemo(
    () => ({ clusters, userId, addCluster, updateClusterMeaning, updateEntryCluster }),
    [clusters, userId, addCluster, updateClusterMeaning, updateEntryCluster]
  );

  // One-time retroactive bulk scan
  useEffect(() => {
    if (
      scanRunning.current ||
      localStorage.getItem(SCAN_KEY) ||
      entries.length === 0
    ) return;

    scanRunning.current = true;
    const unclustered = entries.filter((e) => !e.cluster_id);
    if (unclustered.length < 2) {
      localStorage.setItem(SCAN_KEY, 'true');
      scanRunning.current = false;
      return;
    }

    setScanMsg('🔗 Scanning your vocabulary for word families…');
    bulkScan(unclustered, storeOps, (msg) => setScanMsg(msg))
      .then(async (count) => {
        if (count > 0) await onClusterUpdate();
        localStorage.setItem(SCAN_KEY, 'true');
        setScanMsg(`✓ Word family scan complete${count > 0 ? ` — ${count} cluster${count > 1 ? 's' : ''} found` : ''}`);
        setScanDone(true);
        setTimeout(() => setScanMsg(null), 2500);
      })
      .catch(() => {
        localStorage.setItem(SCAN_KEY, 'true');
        setScanMsg(null);
      })
      .finally(() => {
        scanRunning.current = false;
      });
    // Only run when entries first load (length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length > 0 ? 'loaded' : 'empty']);

  async function handleAdd(data: Omit<VocabEntry, 'id' | 'date_added' | 'starred' | 'review_count'>) {
    const id = await onAdd(data);
    setNewEntryId(id);
    setTimeout(() => setNewEntryId(null), 800);

    // Background cluster detection
    const newEntry: VocabEntry = {
      ...data,
      id,
      date_added: new Date().toISOString(),
      starred: false,
      review_count: 0,
    };
    const existingForDetection = entries; // new entry is not yet in state snapshot from this render

    detectAndCluster(newEntry, existingForDetection, storeOps)
      .then(async (clusterName) => {
        if (clusterName) {
          await onClusterUpdate();
          showToast(`🔗 "${data.term}" grouped with "${clusterName}" — word family detected`);
        }
      })
      .catch(() => {});
  }

  function handleToggleStarSmart(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (entry?.cluster_id) {
      const clusterEntries = entries.filter((e) => e.cluster_id === entry.cluster_id);
      const allStarred = clusterEntries.every((e) => e.starred);
      onStarBatch(clusterEntries.map((e) => e.id), !allStarred);
    } else {
      onToggleStar(id);
    }
  }

  async function handleForceRescan() {
    if (scanRunning.current) return;
    scanRunning.current = true;
    setScanDone(false);
    setScanMsg('🔄 Clearing existing clusters…');
    console.log('[Cluster] Force rescan started — entries:', entries.length);

    try {
      // 1. Remove cluster_id from all vocab_entries (RLS restricts to current user)
      const { error: clearEntriesError } = await supabase
        .from('vocab_entries')
        .update({ cluster_id: null })
        .not('id', 'is', null);
      console.log('[Cluster] Clear entry cluster_ids result:', clearEntriesError);
      if (clearEntriesError) {
        console.warn('[Cluster] Could not clear cluster_ids (column may not exist yet):', clearEntriesError.message);
      }

      // 2. Delete all word_clusters for this user
      const { error: deleteClustersError } = await supabase
        .from('word_clusters')
        .delete()
        .not('id', 'is', null);
      console.log('[Cluster] Delete all clusters result:', deleteClustersError);
      if (deleteClustersError) {
        console.warn('[Cluster] Could not delete clusters (table may not exist yet):', deleteClustersError.message);
      }

      // 3. Refresh store — entries come back with cluster_id = null, clusters = []
      await onClusterUpdate();
      localStorage.removeItem(SCAN_KEY);

      // 4. Treat all entries as unclustered (snapshot before async re-render)
      const allEntries = entries.map((e) => ({ ...e, cluster_id: undefined }));
      if (allEntries.length < 2) {
        setScanMsg('✓ Nothing to cluster (need at least 2 entries)');
        setScanDone(true);
        setTimeout(() => setScanMsg(null), 3000);
        scanRunning.current = false;
        return;
      }

      // 5. Run bulk scan with empty clusters list so it doesn't think clusters exist
      setScanMsg(`🔗 Scanning ${allEntries.length} entries for word families…`);
      const freshStoreOps = { ...storeOps, clusters: [] };
      const count = await bulkScan(allEntries, freshStoreOps, (msg) => setScanMsg(msg));

      // 6. Pull in newly created clusters + entries
      if (count > 0) await onClusterUpdate();
      localStorage.setItem(SCAN_KEY, 'true');

      const msg = count > 0
        ? `✓ Found ${count} word ${count === 1 ? 'family' : 'families'}`
        : '✓ Scan complete — no word families detected';
      setScanMsg(msg);
      setScanDone(true);
      console.log('[Cluster] Force rescan complete. Clusters created:', count);
      setTimeout(() => setScanMsg(null), 4000);
    } catch (e) {
      console.error('[Cluster] Force rescan error:', e);
      setScanMsg(`❌ Rescan failed: ${e instanceof Error ? e.message : 'Unknown error — check console'}`);
      setScanDone(false);
      setTimeout(() => setScanMsg(null), 6000);
    } finally {
      scanRunning.current = false;
    }
  }

  // Build display items: group entries by cluster, dissolve single-member clusters to solo
  const displayItems = useMemo((): DisplayItem[] => {
    const clusterMap = new Map<string, VocabEntry[]>();
    const seenClusterIds = new Set<string>();
    const items: DisplayItem[] = [];

    // Group entries
    for (const entry of entries) {
      const cluster = entry.cluster_id ? clusters.find((c) => c.id === entry.cluster_id) : null;
      if (cluster) {
        const arr = clusterMap.get(cluster.id) ?? [];
        arr.push(entry);
        clusterMap.set(cluster.id, arr);
      } else {
        // No valid cluster — treat as solo immediately
        items.push({ type: 'solo', entry });
      }
    }

    // Now emit clusters (or dissolve them to solo if < 2 members)
    // We emit them in the order their FIRST member appeared in entries[] so sort works correctly
    const clusterOrder: string[] = [];
    for (const entry of entries) {
      if (entry.cluster_id && !seenClusterIds.has(entry.cluster_id)) {
        seenClusterIds.add(entry.cluster_id);
        clusterOrder.push(entry.cluster_id);
      }
    }

    for (const clusterId of clusterOrder) {
      const clusterEntries = clusterMap.get(clusterId);
      const cluster = clusters.find((c) => c.id === clusterId);
      if (!cluster || !clusterEntries) continue;

      if (clusterEntries.length < 2) {
        // Dissolve — show as individual solo cards
        clusterEntries.forEach((e) => items.push({ type: 'solo', entry: e }));
      } else {
        items.push({ type: 'cluster', cluster, entries: clusterEntries });
      }
    }

    return items;
  }, [entries, clusters]);

  // Filter + sort display items
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();

    const matchesEntry = (e: VocabEntry): boolean => {
      const catOk = filterCategory === 'all' || e.category === filterCategory;
      const queryOk =
        !q ||
        e.term.toLowerCase().includes(q) ||
        e.english_definition.toLowerCase().includes(q) ||
        e.chinese_translation.includes(q) ||
        e.example_sentences.some((s) => s.toLowerCase().includes(q));
      return catOk && queryOk;
    };

    const visible = displayItems.filter((item) => {
      if (item.type === 'solo') return matchesEntry(item.entry);
      return item.entries.some(matchesEntry);
    });

    visible.sort((a, b) => {
      // Extract sort-key fields for each item
      const aStarred = a.type === 'solo' ? a.entry.starred : a.entries.some((e) => e.starred);
      const bStarred = b.type === 'solo' ? b.entry.starred : b.entries.some((e) => e.starred);
      const aDate =
        a.type === 'solo'
          ? new Date(a.entry.date_added).getTime()
          : Math.max(...a.entries.map((e) => new Date(e.date_added).getTime()));
      const bDate =
        b.type === 'solo'
          ? new Date(b.entry.date_added).getTime()
          : Math.max(...b.entries.map((e) => new Date(e.date_added).getTime()));
      const aTerm = a.type === 'solo' ? a.entry.term : a.cluster.cluster_name;
      const bTerm = b.type === 'solo' ? b.entry.term : b.cluster.cluster_name;

      if (sort === 'starred') {
        if (aStarred !== bStarred) return aStarred ? -1 : 1;
        return bDate - aDate;
      }
      if (sort === 'date_desc') return bDate - aDate;
      if (sort === 'date_asc') return aDate - bDate;
      if (sort === 'alpha') return aTerm.localeCompare(bTerm);
      return 0;
    });

    return visible;
  }, [displayItems, query, filterCategory, sort]);

  const categoryOptions: { value: FilterCategory; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'word', label: 'Words' },
    { value: 'collocation', label: 'Collocations' },
    { value: 'sentence_pattern', label: 'Sentence Patterns' },
  ];

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: 'starred', label: 'Starred first' },
    { value: 'date_desc', label: 'Newest' },
    { value: 'date_asc', label: 'Oldest' },
    { value: 'alpha', label: 'A–Z' },
  ];

  return (
    <div>
      {/* Scan banner */}
      {scanMsg && (
        <div
          className={`mb-4 px-4 py-2.5 rounded-lg text-sm flex items-center gap-2 transition-colors ${
            scanDone
              ? 'bg-[#EFF6EF] text-[#4A7A4A] border border-[#C8E0C8]'
              : 'bg-stone-50 text-stone-500 border border-stone-200'
          }`}
        >
          {!scanDone && (
            <span className="w-3.5 h-3.5 border-2 border-stone-300 border-t-[#7C9A7E] rounded-full animate-spin flex-shrink-0" />
          )}
          {scanMsg}
        </div>
      )}

      {/* AI Quick-add */}
      <QuickAdd onAdded={handleAdd} />

      {/* Search + filter bar */}
      <div className="mb-5 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search terms, definitions, examples…"
              className="w-full pl-9 pr-4 py-2 border border-stone-300 rounded-sm bg-white text-sm text-[#1C1917] focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-sm text-sm transition-colors ${
              showFilters
                ? 'border-amber-500 bg-amber-50 text-amber-800'
                : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400'
            }`}
          >
            <SlidersHorizontal size={14} />
            <span className="hidden sm:inline">Filter</span>
          </button>
        </div>

        {showFilters && (
          <div className="flex flex-col sm:flex-row gap-3 p-3 bg-stone-50 border border-stone-200 rounded-sm">
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-1.5">
                Category
              </p>
              <div className="flex flex-wrap gap-1.5">
                {categoryOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFilterCategory(opt.value)}
                    className={`px-2.5 py-1 text-xs rounded-sm border transition-colors ${
                      filterCategory === opt.value
                        ? 'bg-[#D97706] text-white border-[#D97706]'
                        : 'bg-white text-stone-600 border-stone-300 hover:border-stone-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-1.5">
                Sort by
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sortOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSort(opt.value)}
                    className={`px-2.5 py-1 text-xs rounded-sm border transition-colors ${
                      sort === opt.value
                        ? 'bg-[#1C1917] text-white border-[#1C1917]'
                        : 'bg-white text-stone-600 border-stone-300 hover:border-stone-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-shrink-0 flex items-end">
              <button
                onClick={handleForceRescan}
                disabled={scanRunning.current}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-[#4A7A4A] border border-[#9DC49D] rounded-sm hover:bg-[#EFF6EF] transition-colors disabled:opacity-50"
                title="Clear all clusters and re-detect word families from scratch"
              >
                <RefreshCw size={11} className={scanRunning.current ? 'animate-spin' : ''} />
                Re-cluster (full reset)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Entry count + force rescan button */}
      <div className="mb-3 flex items-center justify-between">
        <p className="uppercase tracking-[0.1em] text-[#B0A090]" style={{ fontSize: '12px' }}>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          {query && ` matching "${query}"`}
          {clusters.length > 0 && ` · ${clusters.length} word ${clusters.length === 1 ? 'family' : 'families'}`}
        </p>
        {entries.length >= 2 && (
          <button
            onClick={handleForceRescan}
            disabled={scanRunning.current}
            className="flex items-center gap-1 text-[11px] text-[#4A7A4A] border border-[#9DC49D] rounded px-2 py-0.5 hover:bg-[#EFF6EF] transition-colors disabled:opacity-50"
            title="Clear all clusters and re-detect word families from scratch"
          >
            <RefreshCw size={10} className={scanRunning.current ? 'animate-spin' : ''} />
            Re-cluster
          </button>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-stone-400">
          <p className="text-5xl mb-3">📖</p>
          <p className="text-sm">
            {query ? 'No entries match your search.' : 'Type a word above to add your first entry!'}
          </p>
        </div>
      ) : (
        <div className="vocab-grid">
          {filtered.map((item) => {
            if (item.type === 'cluster') {
              return (
                <div key={item.cluster.id} className="vocab-cluster-card">
                  <ClusterCard
                    cluster={item.cluster}
                    entries={item.entries}
                    onToggleStarCluster={(allStarred) =>
                      onStarBatch(item.entries.map((e) => e.id), !allStarred)
                    }
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onUnlink={() => onUnlinkCluster(item.cluster.id)}
                  />
                </div>
              );
            }
            return (
              <div key={item.entry.id} className="vocab-card">
                <EntryCard
                  entry={item.entry}
                  isNew={item.entry.id === newEntryId}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onToggleStar={handleToggleStarSmart}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm text-white shadow-xl whitespace-nowrap"
          style={{ background: '#2D5A2D', boxShadow: '0 4px 20px rgba(45,90,45,0.35)' }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
