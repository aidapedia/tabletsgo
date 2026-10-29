import type { CommandDoc } from '@/shared/ui/CommandDocView'
import { findKafkaCommand } from './commands'

/**
 * Long-form docs for the Kafka console's command language, shown in a console
 * tab from the command reference. The grammar is ours (server/db/kafka-command.js),
 * so these are the only docs there are — keep them in step with the parser.
 */

type Extra = Pick<CommandDoc, 'details' | 'options' | 'returns' | 'examples' | 'notes' | 'writes'>

const WHERE_FIELDS =
  'key, value, value.<json.path>, header.<name>, partition, offset, timestamp — compared with = != > >= < <= or ~ (case-insensitive contains, also spelled CONTAINS), joined by AND. A quoted literal is always text; an unquoted one may be a number, true/false or null.'

const DOCS: Record<string, Extra> = {
  TOPICS: {
    details: ['Lists the topics on the cluster with a partition and replication summary. Internal topics (__consumer_offsets and other "__" names, _schemas, _confluent*) are hidden unless asked for.'],
    options: [
      { name: "LIKE 'pattern'", desc: 'Keep topics matching a glob — * is any run of characters, ? one character. Without a wildcard it is a case-insensitive substring match.' },
      { name: 'INTERNAL', desc: 'Include internal topics.' },
    ],
    returns: 'Rows of topic, partitions, replication, under_replicated.',
    examples: [
      { command: 'TOPICS', response: 'topic          partitions  replication  under_replicated\norders         6           3            0\norders.retry   3           3            0\npayments       12          3            0' },
      { command: "TOPICS LIKE 'orders.*'", note: 'Topics whose name starts with "orders."', response: 'topic          partitions  replication  under_replicated\norders.retry   3           3            0' },
      { command: 'TOPICS INTERNAL', response: 'topic               partitions  replication  under_replicated\n__consumer_offsets  50          3            0\norders              6           3            0\n…' },
    ],
  },
  DESCRIBE: {
    details: ['Shows each partition of a topic: who leads it, where it is replicated, which replicas are in sync, and the retained offset range.'],
    options: [
      { name: 'TOPIC', desc: 'Optional noise word — DESCRIBE TOPIC orders is the same as DESCRIBE orders.' },
      { name: 'GROUP id', desc: 'DESCRIBE GROUP <id> is an alias for LAG <id>.' },
    ],
    returns: 'Rows of partition, leader, replicas, isr, earliest, latest, messages.',
    examples: [{ command: 'DESCRIBE orders', response: 'partition  leader  replicas  isr    earliest  latest  messages\n0          1       1,2,3     1,2,3  0         10432   10432\n1          2       2,3,1     2,3,1  0         10388   10388\n…' }, { command: 'DESCRIBE GROUP billing-service', response: 'Same rows as LAG billing-service.' }],
  },
  CONFIG: {
    writes: undefined, // reads, unless given SET
    details: ['Without SET, reads every config of a topic and whether it is still the broker default. With SET, changes the listed configs and leaves the rest alone.'],
    options: [{ name: 'SET key=value, …', desc: 'One or more comma-separated config overrides, e.g. retention.ms=86400000.' }],
    returns: 'Reading: rows of config, value, default (sensitive values are masked). SET: a message with how many configs changed.',
    examples: [
      { command: 'CONFIG orders', response: 'config               value      default\ncleanup.policy       delete     true\nretention.ms         604800000  true\nmin.insync.replicas  2          false\n…' },
      { command: 'CONFIG orders SET retention.ms=86400000, cleanup.policy=delete', note: 'Keep one day of messages.', response: 'Updated 2 config(s) on orders.' },
    ],
  },
  CONSUME: {
    details: [
      'A bounded, read-only look at a topic. It never joins a consumer group and never commits offsets, so it cannot move anyone’s position.',
      'By default it reads the newest messages of every partition. A WHERE clause scans further back than the row limit to find matches, within the read caps.',
    ],
    options: [
      { name: 'PARTITION n', desc: 'Read one partition only.' },
      { name: 'FROM latest', desc: 'The newest LIMIT messages per partition (default).' },
      { name: 'FROM -N', desc: 'Exactly the last N messages per partition.' },
      { name: 'FROM earliest', desc: 'From the start of the retained log, forward (beginning works too).' },
      { name: 'FROM OFFSET n', desc: 'From offset n, clamped into the retained range.' },
      { name: "FROM 'ISO time'", desc: "From the first message at or after a timestamp, e.g. '2026-10-01T00:00:00Z'." },
      { name: 'LIMIT n', desc: 'How many messages to return (default 100, capped by the server).' },
      { name: 'DECODE fmt', desc: 'auto (UTF-8 text, hex for binary, labels Schema Registry framing), json, string, hex or base64.' },
      { name: 'WHERE …', desc: WHERE_FIELDS },
    ],
    returns: 'Rows of partition, offset, timestamp, key, value, headers, size.',
    examples: [
      { command: 'CONSUME orders LIMIT 20', response: 'partition  offset  timestamp                 key     value                            headers  size\n0          10431   2026-10-29T08:12:03.114Z  ord_91  {"id":"ord_91","amount":120}     {}       29\n1          10387   2026-10-29T08:12:02.870Z  ord_90  {"id":"ord_90","amount":45}      {}       28\n…' },
      { command: 'CONSUME orders FROM earliest LIMIT 50', response: 'partition  offset  timestamp                 key    value                          headers  size\n0          0       2026-10-01T00:00:04.551Z  ord_1  {"id":"ord_1","amount":12}    {}       27\n…' },
      { command: "CONSUME orders FROM '2026-10-01T00:00:00Z' PARTITION 0", response: 'Rows from partition 0 only, starting at the first message on or after that time.' },
      { command: "CONSUME orders WHERE value.amount > 100 AND header.source ~ 'checkout'", note: 'Filter on a JSON field and a header.', response: 'partition  offset  timestamp                 key     value                           headers                 size\n0          10431   2026-10-29T08:12:03.114Z  ord_91  {"id":"ord_91","amount":120}    {"source":"checkout"}   29' },
    ],
    notes: ['A read stops early when it hits the server’s message, byte or time cap — the result says so when it does.'],
  },
  PRODUCE: {
    details: ['Sends one message. Everything after VALUE is the payload, so it must come last.'],
    options: [
      { name: 'PARTITION n', desc: 'Write to a specific partition; otherwise the producer picks one from the key.' },
      { name: "KEY 'k'", desc: 'The message key.' },
      { name: 'HEADERS {…}', desc: 'A JSON object of header names to values.' },
      { name: 'VALUE …', desc: 'The rest of the line. null sends a tombstone; a single quoted string is unquoted; anything else (JSON, plain text) is sent as written.' },
    ],
    returns: 'A message with the partition and offset the record landed at.',
    examples: [
      { command: `PRODUCE orders KEY 'ord_1' VALUE {"id":"ord_1","amount":120}`, response: 'Sent to orders · partition 3 @ offset 10433' },
      { command: `PRODUCE orders HEADERS {"source":"console"} VALUE 'hello'`, response: 'Sent to orders · partition 0 @ offset 10432' },
      { command: "PRODUCE orders KEY 'ord_1' VALUE null", note: 'Tombstone — deletes ord_1 on a compacted topic.', response: 'Sent to orders · partition 3 @ offset 10434' },
    ],
  },
  GROUPS: {
    details: ['Lists consumer groups with their state, member count, total lag and the topics they consume.'],
    returns: 'Rows of group, state, members, lag, topics.',
    examples: [{ command: 'GROUPS', response: 'group            state   members  lag   topics\nbilling-service  Stable  3        12    orders, payments\nanalytics        Empty   0        8410  orders' }],
  },
  LAG: {
    details: ['Per-partition position of one consumer group: what it committed, where the log ends, and the difference.'],
    returns: 'Rows of topic, partition, committed (empty when nothing was committed yet), end, lag, member.',
    examples: [{ command: 'LAG billing-service', response: 'topic     partition  committed  end    lag  member\norders    0          10428      10432  4    consumer-1-6f1c…\norders    1          10380      10388  8    consumer-2-91ab…\npayments  0          5521       5521   0    consumer-3-0d2e…' }],
  },
  CLUSTER: {
    details: ['The brokers in the cluster and which one is the controller.'],
    returns: 'Rows of node_id, host, port, controller, cluster_id.',
    examples: [{ command: 'CLUSTER', response: 'node_id  host     port  controller  cluster_id\n1        kafka-1  9092  true        MkU3OEVBNTcwNTJENDM2Qk\n2        kafka-2  9092  false       MkU3OEVBNTcwNTJENDM2Qk\n3        kafka-3  9092  false       MkU3OEVBNTcwNTJENDM2Qk' }],
  },
  CREATE: {
    details: ['Creates a topic. Partitions and replication fall back to the broker defaults when left out.'],
    options: [
      { name: 'TOPIC name', desc: 'The new topic’s name (required).' },
      { name: 'PARTITIONS n', desc: 'Partition count.' },
      { name: 'REPLICATION r', desc: 'Replication factor — at most the number of brokers.' },
      { name: 'WITH key=value, …', desc: 'Topic configs to set at creation.' },
    ],
    returns: 'A confirmation message.',
    examples: [
      { command: 'CREATE TOPIC orders PARTITIONS 6 REPLICATION 3', response: 'Created topic orders.' },
      { command: 'CREATE TOPIC customers WITH cleanup.policy=compact', response: 'Created topic customers.' },
    ],
  },
  DROP: {
    details: ['Deletes a topic and every message in it. The trailing CONFIRM is required so a stray line can’t do it.'],
    returns: 'A confirmation message.',
    examples: [{ command: 'DROP TOPIC scratch CONFIRM', response: 'Deleted topic scratch.' }],
    notes: ['This cannot be undone.'],
  },
}

/** The docs tab for a Kafka console command, or null when it isn't in the catalog. */
export function kafkaCommandDoc(name: string): CommandDoc | null {
  const spec = findKafkaCommand(name)
  if (!spec) return null
  return { name: spec.name, syntax: spec.args, summary: spec.desc, engine: 'Kafka', writes: !!spec.writes, ...DOCS[spec.name] }
}
