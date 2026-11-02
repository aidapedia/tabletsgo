import { useCallback, useEffect, useState } from 'react'
import RefreshButton from '@/shared/ui/buttons/RefreshButton'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import { alterBroker, describeBroker, listBrokers, type BrokerConfig, type BrokerList } from '../lib/api'
import { num } from '../lib/format'
import ConfigList from './ConfigList'
import Tile from './Tile'

const isOverride = (c: BrokerConfig) => c.dynamic
// A dynamic change reaches DescribeConfigs a moment after it's accepted.
const SETTLE_MS = 1200
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The cluster's brokers: health tiles, then one row per broker — the
 * partitions it leads and replicates, the replicas it has fallen out of sync
 * on, and its leadership skew (how far its share of leaders is from an even
 * split). Picking a broker opens its configuration, where the settings Kafka
 * can change at runtime (dynamic per-broker configs) are editable.
 */
export default function BrokersPanel({ conn }: { conn: any }) {
  const [data, setData] = useState<BrokerList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [configs, setConfigs] = useState<BrokerConfig[] | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)

  const load = useCallback(
    () =>
      listBrokers(conn)
        .then((d) => {
          setData(d)
          setError(null)
          setSelected((s) => s ?? d.controller ?? d.brokers[0]?.nodeId ?? null)
        })
        .catch((e) => setError(e.message)),
    [conn]
  )
  const loadConfigs = useCallback(
    (id: number) =>
      describeBroker(conn, id)
        .then((d) => {
          setConfigs(d.configs)
          setConfigError(null)
        })
        .catch((e) => setConfigError(e.message)),
    [conn]
  )

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (selected == null) return
    setConfigs(null)
    loadConfigs(selected)
  }, [selected, loadConfigs])

  if (error && !data) return <div className="mx-[18px] my-4 rounded-[9px] border border-red/25 bg-red/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
  if (!data) return <div className="p-[30px] text-center text-xs text-ink-faint">Reading the brokers…</div>

  const skewed = data.brokers.filter((b) => Math.abs(b.leaderSkew) >= 25)
  const lagging = data.brokers.filter((b) => b.outOfSync > 0)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        <Tile label="Brokers" value={String(data.brokers.length)} sub={data.controller != null ? `controller is broker ${data.controller}` : 'no active controller'} warn={data.controller == null} />
        <Tile label="Partitions" value={num(data.partitions)} sub={`across ${data.topics} topic${data.topics === 1 ? '' : 's'}, internal included`} />
        <Tile
          label="Under-replicated"
          value={num(data.underReplicated)}
          sub={lagging.length ? `out of sync on broker ${lagging.map((b) => b.nodeId).join(', ')}` : 'every replica in sync'}
          warn={data.underReplicated > 0}
        />
        <Tile label="Offline partitions" value={num(data.offlinePartitions)} sub={data.offlinePartitions ? 'no leader — unreadable and unwritable' : 'every partition has a leader'} warn={data.offlinePartitions > 0} />
        <Tile label="Leader skew" value={skewed.length ? `${skewed.length}` : 'even'} sub={skewed.length ? `broker${skewed.length === 1 ? '' : 's'} ≥25% off an even share` : 'leaders spread evenly'} warn={skewed.length > 0} />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold">Brokers</span>
        <Tooltip label="Refresh" placement="left">
          <RefreshButton size="sm" iconSize={13} aria-label="Refresh brokers" onRefresh={load} />
        </Tooltip>
      </div>
      <div className="mb-6 overflow-x-auto rounded-card border border-edge bg-panel">
        <table className="w-full min-w-[760px] border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[11px] text-ink-faint">
              {['Broker', 'Address', 'Leaders', 'Replicas', 'Out of sync', 'Leader skew'].map((h, i) => (
                <th key={h} className={`h-8 border-b border-edge px-3 font-semibold ${i >= 2 && i <= 4 ? 'text-right' : ''}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.brokers.map((b) => (
              <tr
                key={b.nodeId}
                onClick={() => setSelected(b.nodeId)}
                className={`cursor-pointer ${selected === b.nodeId ? 'bg-green/10' : 'hover:bg-elevated'}`}
              >
                <td className="h-[32px] border-b border-edge/60 px-3 font-mono font-semibold">
                  {b.nodeId}
                  {b.controller && (
                    <span className="ml-2 rounded-[5px] bg-green/15 px-1.5 py-px font-sans text-[9px] font-bold uppercase text-green-bright">controller</span>
                  )}
                </td>
                <td className="border-b border-edge/60 px-3 font-mono text-ink-dim">
                  {b.host}:{b.port}
                </td>
                <td className="border-b border-edge/60 px-3 text-right font-mono tabular-nums">{num(b.leaders)}</td>
                <td className="border-b border-edge/60 px-3 text-right font-mono tabular-nums">{num(b.replicas)}</td>
                <td className={`border-b border-edge/60 px-3 text-right font-mono tabular-nums ${b.outOfSync ? 'font-semibold text-amber' : 'text-ink-dim'}`}>
                  {num(b.outOfSync)}
                </td>
                <td className="border-b border-edge/60 px-3">
                  <SkewBar skew={b.leaderSkew} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected != null && (
        <>
          <div className="mb-2 text-xs font-semibold">
            Broker {selected} configuration
            <span className="ml-2 font-normal text-ink-faint">Editable entries are the ones Kafka can change at runtime; an override applies to this broker only.</span>
          </div>
          {configError && <div className="mb-3 rounded-[9px] border border-red/25 bg-red/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{configError}</div>}
          {configs ? (
            <ConfigList
              configs={configs}
              isOverride={isOverride}
              subject="its static or cluster-wide value"
              emptyText='No runtime overrides on this broker — turn on "Show defaults" to see its whole configuration.'
              onSave={async (name, value) => {
                await alterBroker(conn, selected, { [name]: value })
                await wait(SETTLE_MS)
                await loadConfigs(selected)
              }}
              onRefresh={() => loadConfigs(selected)}
            />
          ) : (
            !configError && <div className="p-6 text-center text-xs text-ink-faint">Reading broker {selected}…</div>
          )}
        </>
      )}
    </div>
  )
}

// Leadership share against an even split: a centred bar, right for more, left for fewer.
function SkewBar({ skew }: { skew: number }) {
  const width = Math.min(Math.abs(skew), 100) / 2
  const tone = Math.abs(skew) >= 25 ? 'bg-amber' : 'bg-green'
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-24 rounded-full bg-elevated">
        <div className="absolute inset-y-0 left-1/2 w-px bg-edge-strong" />
        <div className={`absolute inset-y-0 rounded-full ${tone}`} style={skew >= 0 ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }} />
      </div>
      <span className={`font-mono text-[11px] tabular-nums ${Math.abs(skew) >= 25 ? 'text-amber' : 'text-ink-dim'}`}>
        {skew > 0 ? '+' : ''}
        {skew}%
      </span>
    </div>
  )
}
