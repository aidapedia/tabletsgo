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
import { EditIcon, PlusIcon, TerminalIcon, TrashIcon } from '@/shared/ui/icons'
import { deleteSshGateway, listSshGateways, listSshKeys } from '../lib/api'
import { PROVIDER_LABEL, addressOf, providerOf } from '../lib/providers'
import type { SshGateway, SshKey } from '../types'
import SshGatewayModal from './SshGatewayModal'
import type { SshListHandle } from './SshKeyList'

// A workspace's SSH gateways — the bastions connections tunnel through.
// Members see which exist (a connection names one); `canManage` gates the rest.
const SshGatewayList = forwardRef<SshListHandle, { workspaceId: string; canManage?: boolean }>(function SshGatewayList(
  { workspaceId, canManage = true },
  ref
) {
  const toast = useToast()
  const [gateways, setGateways] = useState<SshGateway[]>([])
  const [keys, setKeys] = useState<SshKey[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ gateway?: SshGateway } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SshGateway | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    setLoading(true)
    Promise.all([listSshGateways(workspaceId), listSshKeys(workspaceId)]).then(([gws, ks]) => {
      setGateways(gws)
      setKeys(ks)
      setLoading(false)
    })
  }, [workspaceId])

  useImperativeHandle(ref, () => ({ openCreate: () => setModal({}) }), [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return gateways
    return gateways.filter(
      (g) => g.name.toLowerCase().includes(q) || g.host.toLowerCase().includes(q) || g.username.toLowerCase().includes(q),
    )
  }, [gateways, query])

  const columns = useMemo<Column<SshGateway>[]>(
    () => [
      {
        key: 'name',
        header: 'Host',
        sortable: true,
        sortValue: (g) => g.name,
        render: (g) => (
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-elevated text-violet-400">
              <TerminalIcon width={18} height={18} />
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold">{g.name}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">{addressOf(g)}</div>
            </div>
          </div>
        ),
      },
      {
        key: 'provider',
        header: 'Route',
        sortable: true,
        sortValue: (g) => PROVIDER_LABEL[providerOf(g)],
        width: 130,
        render: (g) => <Badge>{PROVIDER_LABEL[providerOf(g)]}</Badge>,
      },
      {
        key: 'auth',
        header: 'Authentication',
        sortable: true,
        sortValue: (g) => (g.auth === 'key' ? g.keyName || '' : 'password'),
        width: 220,
        render: (g) =>
          g.auth === 'key' ? (
            <span className="block truncate text-ink-dim">Key · {g.keyName || '—'}</span>
          ) : (
            <span className="text-ink-dim">Password</span>
          ),
      },
      {
        key: 'hostFingerprint',
        header: 'Host key',
        sortable: true,
        sortValue: (g) => (g.hostFingerprint ? 1 : 0),
        width: 130,
        className: 'max-[900px]:hidden',
        render: (g) => <Badge>{g.hostFingerprint ? 'Pinned' : 'Not seen yet'}</Badge>,
      },
      ...(canManage
        ? [
            {
              key: 'actions',
              header: '',
              align: 'right' as const,
              width: 60,
              render: (g: SshGateway) => (
                <RowActions>
                  <RowMenu label={`Actions for ${g.name}`} width={160}>
                    {({ close }) => (
                      <div className="p-1">
                        <MenuItem onClick={() => { close(); setModal({ gateway: g }) }}>
                          <EditIcon width={14} height={14} /> Edit
                        </MenuItem>
                        <div className="my-1 h-px bg-edge" />
                        <MenuItem danger onClick={() => { close(); setPendingDelete(g) }}>
                          <TrashIcon width={14} height={14} /> Delete
                        </MenuItem>
                      </div>
                    )}
                  </RowMenu>
                </RowActions>
              ),
            },
          ]
        : []),
    ],
    [canManage],
  )

  const table = useDataTable({ rows: filtered, columns, pageSize: 10, resetKey: query })

  const handleSaved = (g: SshGateway) =>
    setGateways((prev) => (prev.some((x) => x.id === g.id) ? prev.map((x) => (x.id === g.id ? g : x)) : [...prev, g]))

  const handleDelete = async () => {
    if (!pendingDelete) return
    try {
      await deleteSshGateway(pendingDelete.id)
      setGateways((prev) => prev.filter((g) => g.id !== pendingDelete.id))
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setPendingDelete(null)
    }
  }

  return (
    <>
      <div className="mb-4">
        <SearchInput placeholder="Search SSH hosts…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <DataTable
        columns={columns}
        rowKey={(g) => g.id}
        onRowClick={canManage ? (g) => setModal({ gateway: g }) : undefined}
        loading={loading}
        empty={
          query.trim() ? (
            'No SSH hosts match your search.'
          ) : (
            <div className="flex flex-col items-center gap-3">
              <TerminalIcon width={28} height={28} className="text-ink-faint" />
              <span>No SSH hosts yet.</span>
              {canManage && (
                <Button variant="primary" size="sm" icon={PlusIcon} onClick={() => setModal({})}>
                  Add your first host
                </Button>
              )}
            </div>
          )
        }
        {...table}
      />

      {modal && (
        <SshGatewayModal
          workspaceId={workspaceId}
          initial={modal.gateway || null}
          keys={keys}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.name}"?`}
          message="Connections still tunneling through it must be switched first. This can't be undone."
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  )
})

export default SshGatewayList
