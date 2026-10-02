import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import SearchInput from '@/shared/ui/form/SearchInput'
import Badge from '@/shared/ui/Badge'
import DataTable from '@/shared/ui/table/DataTable'
import type { Column } from '@/shared/ui/table/DataTable'
import { RowActions, RowMenu } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import { CopyIcon, EditIcon, KeyIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { deleteSshKey, listSshKeys } from '../lib/api'
import type { SshKey } from '../types'
import SshKeyModal from './SshKeyModal'

export type SshListHandle = { openCreate: () => void }

// `ssh-ed25519` → `ED25519`: the algorithm as people say it.
const algorithmLabel = (a: string) => a.replace(/^ssh-/, '').replace(/^ecdsa-sha2-/, 'ecdsa ').toUpperCase()

// A workspace's SSH keys. Everyone in the workspace can see them and copy a
// public key (that half is meant to be shared); `canManage` gates create,
// rename and delete.
const SshKeyList = forwardRef<SshListHandle, { workspaceId: string; canManage?: boolean }>(function SshKeyList(
  { workspaceId, canManage = true },
  ref
) {
  const toast = useToast()
  const [keys, setKeys] = useState<SshKey[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ key?: SshKey } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SshKey | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    setLoading(true)
    listSshKeys(workspaceId).then((list) => {
      setKeys(list)
      setLoading(false)
    })
  }, [workspaceId])

  useImperativeHandle(ref, () => ({ openCreate: () => setModal({}) }), [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return keys
    return keys.filter((k) => k.name.toLowerCase().includes(q) || k.fingerprint.toLowerCase().includes(q))
  }, [keys, query])

  const copy = (k: SshKey) => {
    navigator.clipboard?.writeText(k.publicKey)
    toast.success('Public key copied.')
  }

  const columns = useMemo<Column<SshKey>[]>(
    () => [
      {
        key: 'name',
        header: 'Key',
        sortable: true,
        sortValue: (k) => k.name,
        render: (k) => (
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-elevated text-amber-400">
              <KeyIcon width={18} height={18} />
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold">{k.name}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">{k.fingerprint}</div>
            </div>
          </div>
        ),
      },
      {
        key: 'algorithm',
        header: 'Algorithm',
        sortable: true,
        sortValue: (k) => k.algorithm,
        width: 150,
        render: (k) => <Badge>{algorithmLabel(k.algorithm)}</Badge>,
      },
      {
        key: 'createdAt',
        header: 'Added',
        sortable: true,
        sortValue: (k) => k.createdAt || 0,
        width: 140,
        className: 'max-[900px]:hidden',
        render: (k) => <span className="text-ink-dim">{k.createdAt ? new Date(k.createdAt).toLocaleDateString() : '—'}</span>,
      },
      {
        key: 'actions',
        header: '',
        align: 'right' as const,
        width: 60,
        render: (k: SshKey) => (
          <RowActions>
            <RowMenu label={`Actions for ${k.name}`} width={180}>
              {({ close }) => (
                <div className="p-1">
                  <MenuItem onClick={() => { close(); copy(k) }}>
                    <CopyIcon width={14} height={14} /> Copy public key
                  </MenuItem>
                  {canManage && (
                    <>
                      <MenuItem onClick={() => { close(); setModal({ key: k }) }}>
                        <EditIcon width={14} height={14} /> Rename
                      </MenuItem>
                      <div className="my-1 h-px bg-edge" />
                      <MenuItem danger onClick={() => { close(); setPendingDelete(k) }}>
                        <TrashIcon width={14} height={14} /> Delete
                      </MenuItem>
                    </>
                  )}
                </div>
              )}
            </RowMenu>
          </RowActions>
        ),
      },
    ],
    [canManage],
  )

  const table = useDataTable({ rows: filtered, columns, pageSize: 10, resetKey: query })

  const handleSaved = (k: SshKey) =>
    setKeys((prev) => (prev.some((x) => x.id === k.id) ? prev.map((x) => (x.id === k.id ? k : x)) : [...prev, k]))

  const handleDelete = async () => {
    if (!pendingDelete) return
    try {
      await deleteSshKey(pendingDelete.id)
      setKeys((prev) => prev.filter((k) => k.id !== pendingDelete.id))
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setPendingDelete(null)
    }
  }

  return (
    <>
      <div className="mb-4">
        <SearchInput placeholder="Search SSH keys…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <DataTable
        columns={columns}
        rowKey={(k) => k.id}
        onRowClick={(k) => setModal({ key: k })}
        loading={loading}
        empty={
          query.trim() ? (
            'No SSH keys match your search.'
          ) : (
            <div className="flex flex-col items-center gap-3">
              <KeyIcon width={28} height={28} className="text-ink-faint" />
              <span>No SSH keys yet.</span>
              {canManage && (
                <Button variant="primary" size="sm" icon={PlusIcon} onClick={() => setModal({})}>
                  Add your first key
                </Button>
              )}
            </div>
          )
        }
        {...table}
      />

      {modal && (
        <SshKeyModal
          workspaceId={workspaceId}
          initial={modal.key || null}
          canManage={canManage}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.name}"?`}
          message="The private key is destroyed with it. Remove its public key from any host's authorized_keys too. This can't be undone."
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  )
})

export default SshKeyList
