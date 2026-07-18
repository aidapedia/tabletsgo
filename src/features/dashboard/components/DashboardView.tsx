import { useEffect, useRef, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import ContextMenu from '@/shared/ui/overlay/ContextMenu'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import {
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  MaximizeIcon,
  MinimizeIcon,
  PlusIcon,
  RefreshIcon,
  SaveIcon,
  SettingsIcon,
  TrashIcon,
  UploadIcon,
} from '@/shared/ui/icons'
import { getSchema } from '@/shared/api/database'
import { getDashboard, updateDashboard } from '../lib/api'
import type { Breakpoint, Dashboard, DashboardConfig, DashboardExport, Widget } from '../types'
import { emptyConfig, sanitizeConfig } from '../types'
import { GRID_COLS, cellFromPoint, findFreeSlot, slotAtOrFree } from '../lib/grid'
import VariableBar from './VariableBar'
import WidgetGrid, { type LayoutUpdate } from './WidgetGrid'
import WidgetCard from './WidgetCard'
import WidgetEditor from './WidgetEditor'
import DashboardSettings from './DashboardSettings'

const DIALECT = { postgresql: 'PostgreSQL', sqlite: 'SQLite', redis: 'Redis' }

const newWidget = (config: DashboardConfig, cell?: { x: number; y: number }): Widget => ({
  id: `w${Date.now()}`,
  type: 'bar',
  title: '',
  query: '',
  layout: cell ? slotAtOrFree(config.widgets, 4, 4, cell.x, cell.y) : findFreeSlot(config.widgets, 4, 4),
})

// One dashboard tab: variable bar + collision-free widget grid, with settings,
// JSON export/import, and a browser fullscreen mode. The grid is read-only
// until "Edit" is toggled on; edits then accumulate in a local draft and only
// reach PUT /connections/:id/dashboards/:did when "Save" is clicked (or are
// thrown away by "Cancel").
export default function DashboardView({
  conn,
  dashboardId,
  onRename,
}: {
  conn: any
  dashboardId: string
  onRename?: (id: string, name: string) => void
}) {
  const toast = useToast()
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [schema, setSchema] = useState<Record<string, string[]>>({})
  const [varValues, setVarValues] = useState<Record<string, string>>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState<DashboardConfig | null>(null)
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsAddVar, setSettingsAddVar] = useState(false)
  const [deletingWidget, setDeletingWidget] = useState<Widget | null>(null)
  const [pendingImport, setPendingImport] = useState<DashboardExport | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [menu, setMenu] = useState<
    | { x: number; y: number; kind: 'empty'; cell: { x: number; y: number } }
    | { x: number; y: number; kind: 'widget'; widget: Widget }
    | null
  >(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const gridWrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const saved = dashboard?.config ?? emptyConfig()
  const config = editMode ? draft ?? saved : saved
  const dialect = DIALECT[conn?.type as keyof typeof DIALECT]
  const dirty = editMode && JSON.stringify(draft) !== JSON.stringify(saved)

  useEffect(() => {
    let alive = true
    getDashboard(conn.id, dashboardId)
      .then((d) => alive && setDashboard({ ...d, config: sanitizeConfig(d.config) }))
      .catch((e) => alive && setLoadError(e.message))
    getSchema(conn).then((s) => alive && setSchema(s || {}))
    setEditMode(false)
    setDraft(null)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id, dashboardId])

  // ---- Edit mode ----
  const startEdit = () => {
    setDraft(saved)
    setEditMode(true)
  }
  const cancelEdit = () => {
    setDraft(null)
    setEditMode(false)
  }
  const saveEdit = async () => {
    if (!draft) return
    setSaving(true)
    try {
      await updateDashboard(conn.id, dashboardId, { config: draft })
      setDashboard((d) => (d ? { ...d, config: draft } : d))
      setDraft(null)
      setEditMode(false)
    } catch (e: any) {
      toast.error(`Couldn't save dashboard: ${e.message}`)
    }
    setSaving(false)
  }
  const patchDraft = (next: DashboardConfig) => setDraft(next)

  const openSettings = () => {
    setSettingsAddVar(false)
    setSettingsOpen(true)
  }
  // Reached from the always-visible variable bar: enters edit mode (if needed)
  // and opens Settings straight into the "add variable" form.
  const openAddVariable = () => {
    if (!editMode) startEdit()
    setSettingsAddVar(true)
    setSettingsOpen(true)
  }

  // ---- Grid layout ----
  // `lg` edits update the base layout; smaller breakpoints keep their tweaks in
  // `layouts[bp]` so they never overwrite the desktop layout.
  const commitLayouts = (updates: LayoutUpdate[], breakpoint: Breakpoint) => {
    const byId = new Map(updates.map((u) => [u.id, u.layout]))
    patchDraft({
      ...config,
      widgets: config.widgets.map((w) => {
        const next = byId.get(w.id)
        if (!next) return w
        return breakpoint === 'lg' ? { ...w, layout: next } : { ...w, layouts: { ...w.layouts, [breakpoint]: next } }
      }),
    })
  }

  // ---- Right-click menu (edit mode) ----
  // Empty space → "Add widget" (placed where clicked); a widget → its actions.
  const onGridContextMenu = (e: React.MouseEvent) => {
    if (!editMode) return
    const widgetEl = (e.target as HTMLElement).closest('[data-widget-id]')
    e.preventDefault()
    if (widgetEl) {
      const w = config.widgets.find((x) => x.id === widgetEl.getAttribute('data-widget-id'))
      if (w) setMenu({ x: e.clientX, y: e.clientY, kind: 'widget', widget: w })
      return
    }
    const gridEl = gridWrapRef.current?.querySelector('.widget-grid') as HTMLElement | null
    const cell = gridEl ? cellFromPoint(gridEl, e.clientX, e.clientY, GRID_COLS) : { x: 0, y: 0 }
    setMenu({ x: e.clientX, y: e.clientY, kind: 'empty', cell })
  }

  // ---- Widget CRUD ----
  const saveWidget = (w: Widget) => {
    const exists = config.widgets.some((x) => x.id === w.id)
    patchDraft({ ...config, widgets: exists ? config.widgets.map((x) => (x.id === w.id ? w : x)) : [...config.widgets, w] })
    setEditingWidget(null)
  }
  const duplicateWidget = (w: Widget) => {
    const copy: Widget = {
      ...w,
      id: `w${Date.now()}`,
      title: `${w.title} (copy)`,
      layout: findFreeSlot(config.widgets, w.layout.w, w.layout.h),
    }
    patchDraft({ ...config, widgets: [...config.widgets, copy] })
  }
  const deleteWidget = (id: string) => {
    patchDraft({ ...config, widgets: config.widgets.filter((w) => w.id !== id) })
    setDeletingWidget(null)
  }

  // ---- Settings (title + variables) ----
  const saveSettings = async ({ name, variables }) => {
    setSettingsOpen(false)
    patchDraft({ ...config, variables })
    if (dashboard && name !== dashboard.name) {
      setDashboard((d) => (d ? { ...d, name } : d))
      try {
        await updateDashboard(conn.id, dashboardId, { name })
        onRename?.(dashboardId, name)
      } catch (e: any) {
        toast.error(`Rename failed: ${e.message}`)
      }
    }
  }

  // ---- Export / import ----
  const exportJson = () => {
    if (!dashboard) return
    const doc: DashboardExport = { kind: 'dashboard', version: 1, name: dashboard.name, config }
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${dashboard.name.replace(/[^\w-]+/g, '-').toLowerCase()}.dashboard.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const onImportFile = async (file: File) => {
    try {
      const doc = JSON.parse(await file.text())
      if (doc?.kind !== 'dashboard' || !doc.config) throw new Error('Not a dashboard export file.')
      setPendingImport(doc)
    } catch (e: any) {
      toast.error(`Import failed: ${e.message}`)
    }
  }
  const applyImport = () => {
    if (!pendingImport) return
    patchDraft(sanitizeConfig(pendingImport.config))
    setPendingImport(null)
    toast.success('Dashboard structure imported — click Save to keep it.')
  }

  // ---- Fullscreen ----
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else rootRef.current?.requestFullscreen().catch(() => toast.error('Fullscreen is not available.'))
  }

  if (loadError) {
    return <div className="flex flex-1 items-center justify-center text-xs text-red">{loadError}</div>
  }
  if (!dashboard) {
    return (
      <div className="flex-1">
        <LoadingState className="py-10 text-center" />
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      {/* Toolbar — wraps to a second row on narrow screens instead of overflowing. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-edge px-4 py-2.5 max-[720px]:px-3">
        <span className="min-w-0 truncate text-xs font-semibold text-ink">{dashboard.name}</span>
        <span className="text-[10px] text-ink-faint">{saving ? 'Saving…' : editMode && dirty ? 'Unsaved changes' : ''}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Tooltip label="Refresh all widgets" placement="bottom">
            <IconButton size="toolbar" aria-label="Refresh" onClick={() => setRefreshKey((k) => k + 1)}>
              <RefreshIcon width={15} height={15} />
            </IconButton>
          </Tooltip>
          <VariableBar
            conn={conn}
            variables={config.variables}
            values={varValues}
            onChange={(name, value) => setVarValues((v) => ({ ...v, [name]: value }))}
            onAddVariable={openAddVariable}
            refreshKey={refreshKey}
          />
          {editMode && (
            <>
              <Tooltip label="Dashboard settings" placement="bottom">
                <IconButton size="toolbar" aria-label="Dashboard settings" onClick={openSettings}>
                  <SettingsIcon width={15} height={15} />
                </IconButton>
              </Tooltip>
              <Tooltip label="Import structure from JSON" placement="bottom">
                <IconButton size="toolbar" aria-label="Import JSON" onClick={() => fileRef.current?.click()}>
                  <UploadIcon width={15} height={15} />
                </IconButton>
              </Tooltip>
            </>
          )}
          <Tooltip label="Export structure as JSON" placement="bottom">
            <IconButton size="toolbar" aria-label="Export JSON" onClick={exportJson}>
              <DownloadIcon width={15} height={15} />
            </IconButton>
          </Tooltip>
          <Tooltip label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} placement="bottom">
            <IconButton size="toolbar" aria-label="Toggle fullscreen" onClick={toggleFullscreen}>
              {fullscreen ? <MinimizeIcon width={15} height={15} /> : <MaximizeIcon width={15} height={15} />}
            </IconButton>
          </Tooltip>
          {editMode ? (
            <>
              <Button variant="subtle" size="sm" icon={CloseIcon} onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" icon={SaveIcon} onClick={saveEdit} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          ) : (
            <Button variant="subtle" size="sm" icon={EditIcon} onClick={startEdit}>
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div ref={gridWrapRef} className="min-h-0 flex-1 overflow-y-auto" onContextMenu={onGridContextMenu}>
        {config.widgets.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm font-semibold text-ink">This dashboard is empty</p>
              <p className="mx-auto mt-2 max-w-[340px] text-xs leading-relaxed text-ink-dim">
                {editMode
                  ? 'Add a widget and power it with a SQL query — charts, tables, metrics and text. Tip: right-click the grid to add one where you click.'
                  : "You don't have any widgets yet — click Edit to add one."}
              </p>
              {editMode && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={PlusIcon}
                  className="mt-4"
                  onClick={() => setEditingWidget(newWidget(config))}
                >
                  Add widget
                </Button>
              )}
            </div>
          </div>
        ) : (
          <WidgetGrid
            widgets={config.widgets}
            editable={editMode}
            onLayoutsCommit={commitLayouts}
            renderWidget={(w) => (
              <WidgetCard
                conn={conn}
                widget={w}
                values={varValues}
                refreshKey={refreshKey}
                editable={editMode}
                onEdit={() => setEditingWidget(w)}
                onDuplicate={() => duplicateWidget(w)}
                onDelete={() => setDeletingWidget(w)}
              />
            )}
          />
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onImportFile(f)
          e.target.value = ''
        }}
      />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} width={180} onClose={() => setMenu(null)}>
          {menu.kind === 'empty' ? (
            <MenuItem onClick={() => { setEditingWidget(newWidget(config, menu.cell)); setMenu(null) }}>
              <PlusIcon width={14} height={14} /> Add widget
            </MenuItem>
          ) : (
            <>
              <MenuItem onClick={() => { setEditingWidget(menu.widget); setMenu(null) }}>
                <EditIcon width={14} height={14} /> Edit
              </MenuItem>
              <MenuItem onClick={() => { duplicateWidget(menu.widget); setMenu(null) }}>
                <CopyIcon width={14} height={14} /> Duplicate
              </MenuItem>
              <div className="my-1 h-px bg-edge" />
              <MenuItem danger onClick={() => { setDeletingWidget(menu.widget); setMenu(null) }}>
                <TrashIcon width={14} height={14} /> Delete
              </MenuItem>
            </>
          )}
        </ContextMenu>
      )}

      {editingWidget && (
        <WidgetEditor
          conn={conn}
          dialect={dialect}
          schema={schema}
          widget={editingWidget}
          variables={config.variables}
          variableValues={varValues}
          onSave={saveWidget}
          onClose={() => setEditingWidget(null)}
        />
      )}
      {settingsOpen && (
        <DashboardSettings
          name={dashboard.name}
          variables={config.variables}
          dialect={dialect}
          schema={schema}
          startWithNewVariable={settingsAddVar}
          onSave={saveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {deletingWidget && (
        <ConfirmDialog
          danger
          title="Delete widget?"
          message={`"${deletingWidget.title}" will be removed from this dashboard.`}
          confirmLabel="Delete"
          onConfirm={() => deleteWidget(deletingWidget.id)}
          onCancel={() => setDeletingWidget(null)}
        />
      )}
      {pendingImport && (
        <ConfirmDialog
          danger
          title="Replace dashboard contents?"
          message={`Importing "${pendingImport.name}" replaces this dashboard's widgets and variables. The current structure will be lost.`}
          confirmLabel="Import"
          onConfirm={applyImport}
          onCancel={() => setPendingImport(null)}
        />
      )}
    </div>
  )
}
