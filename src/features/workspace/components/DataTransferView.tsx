import Segmented from '@/shared/ui/form/Segmented'
import DataExportPane from './DataExportPane'
import DataImportPane from './DataImportPane'

export type TransferMode = 'export' | 'import'

const MODES = [
  { value: 'export', label: 'Export' },
  { value: 'import', label: 'Import' },
]

/**
 * The console's Export / Import tab — table rows out to CSV/JSON/SQL files and
 * back in. The mode lives on the tab, so the toolbar's Export and Import
 * buttons both land on this one tab, each in its own mode.
 */
export default function DataTransferView({
  conn,
  tables,
  mode,
  onModeChange,
  onImported,
}: {
  conn: any
  tables: string[]
  mode: TransferMode
  onModeChange: (mode: TransferMode) => void
  onImported: () => void
}) {
  const switcher = <Segmented value={mode} onChange={onModeChange} options={MODES} />
  return mode === 'import' ? (
    <DataImportPane conn={conn} switcher={switcher} onImported={onImported} />
  ) : (
    <DataExportPane conn={conn} tables={tables} switcher={switcher} />
  )
}
