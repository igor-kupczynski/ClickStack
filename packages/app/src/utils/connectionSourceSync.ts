type ConnectionSourceSyncResult =
  | { field: 'connection'; value: string }
  | { field: 'source'; value: '' }
  | null;

/**
 * Decides how a form's `connection` and `source` fields should be kept in
 * sync. Extracted as a pure function so the behavior can be unit tested
 * independently of the components' effects.
 */
export function resolveConnectionSourceSync({
  source,
  connection,
  prevSource,
  prevConnection,
  sources,
}: {
  source: string | undefined;
  connection: string | undefined;
  prevSource: string | undefined;
  prevConnection: string | undefined;
  sources: { id: string; connection: string }[] | undefined;
}): ConnectionSourceSyncResult {
  if (!sources) return null;

  // When the source changes, sync the connection to match.
  if (source !== prevSource) {
    const sourceConnection = sources.find(s => s.id === source)?.connection;
    if (sourceConnection && sourceConnection !== connection) {
      return { field: 'connection', value: sourceConnection };
    }
    return null;
  }

  // Set a default connection when none is selected.
  if (!connection) {
    const defaultConnection = sources[0]?.connection;
    if (defaultConnection) {
      return { field: 'connection', value: defaultConnection };
    }
    return null;
  }

  // When the connection changes, clear the source only if the currently
  // selected source doesn't belong to the new connection. This avoids clearing
  // a source that was just carried over (e.g. from builder mode), where the
  // connection change above was itself triggered by the source.
  if (connection !== prevConnection && prevConnection !== undefined) {
    const sourceConnection = sources.find(s => s.id === source)?.connection;
    if (source && sourceConnection !== connection) {
      return { field: 'source', value: '' };
    }
  }

  return null;
}
