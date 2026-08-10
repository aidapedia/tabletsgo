import { useEffect, useMemo, useState } from 'react'
import Modal from '@/shared/ui/overlay/Modal'
import Button from '@/shared/ui/buttons/Button'
import Select from '@/shared/ui/form/Select'
import { Input } from '@/shared/ui/form/Input'
import { Form, FormField } from '@/shared/ui/form/Form'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { DatabaseIcon, DiagramIcon } from '@/shared/ui/icons'
import { listSchemaEngines } from '../lib/api'
import type { SchemaEngine } from '../types'

type Source = 'connection' | 'scratch'

// The two ways to start a schema, as a pair of cards rather than a dropdown:
// they lead to different pickers below, and the difference between "against a
// database that exists" and "on paper" is the decision, not a field value.
function SourceCard({
  active,
  title,
  desc,
  Icon,
  onClick,
}: {
  active: boolean
  title: string
  desc: string
  Icon: any
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 flex-col gap-1.5 rounded-card border p-3 text-left transition-colors ${
        active ? 'border-green bg-green/10' : 'border-edge bg-elevated hover:border-edge-strong'
      }`}
    >
      <span className={`flex h-7 w-7 items-center justify-center rounded-[9px] ${active ? 'bg-green text-white' : 'bg-panel text-ink-dim'}`}>
        <Icon width={14} height={14} />
      </span>
      <span className="text-[12px] font-semibold text-ink">{title}</span>
      <span className="text-[11px] leading-relaxed text-ink-dim">{desc}</span>
    </button>
  )
}

/**
 * "New schema" — pick where the diagram starts.
 *
 * **From a connection** opens the designer in that connection's console, on the
 * live schema: the tables are already drawn and what you stage runs against
 * them. Nothing is created here — the console owns that tab, so this only
 * navigates.
 *
 * **From scratch** has no database behind it, so the one thing a connection
 * would have answered is asked instead: which dialect to write DDL in. That
 * makes a workspace-level draft, edited on its own page and exported as SQL
 * (there is nothing to run it against until it's applied to a connection).
 *
 * The engine list comes from the backend driver registry, so an engine with no
 * schema to draw (Redis) is absent without this file naming it.
 */
export default function NewSchemaDialog({
  connections = [],
  onClose,
  onFromConnection,
  onFromScratch,
}: {
  connections: { id: string; name: string; type: string }[]
  onClose: () => void
  onFromConnection: (connectionId: string) => void
  onFromScratch: (fields: { name: string; dbType: string }) => Promise<void> | void
}) {
  const [source, setSource] = useState<Source>('connection')
  const [engines, setEngines] = useState<SchemaEngine[]>([])
  const [connectionId, setConnectionId] = useState('')
  const [dbType, setDbType] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listSchemaEngines().then(setEngines)
  }, [])

  // Only connections whose engine can hold a schema — the same registry answer
  // that fills the type picker, so Redis is out of both lists for one reason.
  const designable = useMemo(() => {
    if (!engines.length) return connections
    const types = new Set(engines.map((e) => e.type))
    return connections.filter((c) => types.has(c.type))
  }, [connections, engines])

  // Default each picker to its first option once the lists are in.
  useEffect(() => {
    if (!connectionId && designable.length) setConnectionId(designable[0].id)
  }, [designable, connectionId])
  useEffect(() => {
    if (!dbType && engines.length) setDbType(engines[0].type)
  }, [engines, dbType])

  const canSubmit = source === 'connection' ? !!connectionId : !!name.trim() && !!dbType

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || busy) return
    if (source === 'connection') return onFromConnection(connectionId)
    setBusy(true)
    try {
      await onFromScratch({ name: name.trim(), dbType })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="New schema" onClose={onClose} width={520}>
      <Form onSubmit={submit}>
        <div className="mb-4 flex gap-2.5">
          <SourceCard
            active={source === 'connection'}
            title="From a connection"
            desc="Design against a live database — its tables are already on the canvas."
            Icon={DatabaseIcon}
            onClick={() => setSource('connection')}
          />
          <SourceCard
            active={source === 'scratch'}
            title="From scratch"
            desc="An empty canvas for a database that doesn't exist yet. Exports as SQL."
            Icon={DiagramIcon}
            onClick={() => setSource('scratch')}
          />
        </div>

        {source === 'connection' ? (
          designable.length ? (
            <FormField label="Connection" hint="The designer opens in this connection's console.">
              <Select
                value={connectionId}
                onChange={setConnectionId}
                options={designable.map((c) => ({ value: c.id, label: c.name, hint: c.type }))}
              />
            </FormField>
          ) : (
            <EmptyState>
              No connection here can hold a schema — add one, or start from scratch.
            </EmptyState>
          )
        ) : (
          <>
            <FormField label="Name">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Billing schema" />
            </FormField>
            <FormField label="Database type" hint="Decides the column types and the SQL the diagram generates.">
              <Select
                value={dbType}
                onChange={setDbType}
                options={engines.map((e) => ({ value: e.type, label: e.label, hint: `${e.dataTypes.length} column types` }))}
              />
            </FormField>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!canSubmit || busy}>
            {busy ? 'Creating…' : source === 'connection' ? 'Open designer' : 'Create schema'}
          </Button>
        </div>
      </Form>
    </Modal>
  )
}
