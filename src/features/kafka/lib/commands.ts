/**
 * The Kafka console's command catalog — autocomplete, the inline argument hint
 * and the reference panel. The grammar itself lives on the server
 * (server/db/kafka-command.js); this is only what the editor offers.
 */

export type KafkaCommandSpec = {
  name: string
  args: string
  desc: string
  /** What the token after the command names, for completion. */
  takes?: 'topic' | 'group'
  /** True when running it changes the cluster — the sidebar refreshes after. */
  writes?: boolean
}

export const KAFKA_COMMANDS: KafkaCommandSpec[] = [
  { name: 'TOPICS', args: "[LIKE 'orders.*'] [INTERNAL]", desc: 'List topics' },
  { name: 'DESCRIBE', args: 'topic', desc: 'Partitions, leaders, ISR and offsets', takes: 'topic' },
  { name: 'CONFIG', args: 'topic [SET key=value, …]', desc: 'Read or change topic configs', takes: 'topic', writes: true },
  {
    name: 'CONSUME',
    args: "topic [PARTITION n] [FROM earliest|latest|-N|OFFSET n|'ISO'] [LIMIT n] [DECODE auto|string|hex|base64] [WHERE …]",
    desc: 'Bounded read — never joins a group, never commits',
    takes: 'topic',
  },
  { name: 'PRODUCE', args: "topic [PARTITION n] [KEY 'k'] [HEADERS {…}] VALUE …", desc: 'Send one message (VALUE null = tombstone)', takes: 'topic', writes: true },
  { name: 'GROUPS', args: '[TOPIC topic]', desc: 'Consumer groups with state and lag' },
  { name: 'LAG', args: 'group', desc: 'Per-partition committed offset, end and lag', takes: 'group' },
  { name: 'CLUSTER', args: '', desc: 'Brokers and the controller' },
  { name: 'CREATE', args: 'TOPIC name [PARTITIONS n] [REPLICATION r] [WITH key=value, …]', desc: 'Create a topic', writes: true },
  { name: 'DROP', args: 'TOPIC name CONFIRM', desc: 'Delete a topic and its messages', writes: true },
]

export const KAFKA_COMMAND_NAMES = new Set(KAFKA_COMMANDS.map((c) => c.name))

const byName = new Map(KAFKA_COMMANDS.map((c) => [c.name, c]))
export const findKafkaCommand = (name: string) => byName.get(String(name || '').toUpperCase()) || null

// Clause keywords the editor highlights as keywords too.
export const KAFKA_KEYWORDS = new Set([
  'LIKE', 'INTERNAL', 'SET', 'PARTITION', 'FROM', 'OFFSET', 'LIMIT', 'DECODE', 'WHERE', 'AND', 'CONTAINS', 'KEY',
  'HEADERS', 'VALUE', 'TOPIC', 'GROUP', 'PARTITIONS', 'REPLICATION', 'WITH', 'CONFIRM', 'EARLIEST', 'LATEST', 'NULL',
])

/** True when any line of the buffer runs a command that changes the cluster. */
export const buffersWrites = (text: string) =>
  text.split(/\r?\n/).some((l) => findKafkaCommand(l.trim().split(/\s+/)[0])?.writes)
