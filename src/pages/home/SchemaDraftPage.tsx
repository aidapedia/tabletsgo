import SchemaDraftView from '@/features/schema-designer/components/SchemaDraftView'
import { useConnections } from '@/features/connections'

// The feature owns the editor flow; the page only supplies its route.
export default function SchemaDraftPage() {
  const { connections, loading: connectionsLoading, patchLocalConnection } = useConnections()
  return <SchemaDraftView connections={connections} connectionsLoading={connectionsLoading} patchLocalConnection={patchLocalConnection} />
}
