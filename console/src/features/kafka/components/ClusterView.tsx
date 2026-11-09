import type { ClusterPanel } from '../lib/services'
import AclsPanel from './AclsPanel'
import BrokersPanel from './BrokersPanel'

/** One cluster-wide view, by id — opened from the console toolbar. */
export default function ClusterView({ conn, panel }: { conn: any; panel: ClusterPanel }) {
  return panel === 'acls' ? <AclsPanel conn={conn} /> : <BrokersPanel conn={conn} />
}
