/**
 * jfpdemo-server-config — a config node holding connection details for a
 * downstream server. This is the pattern for anything your nodes need to
 * share: a server address, an API key, a set of credentials.
 *
 * Config nodes have no inputs or outputs. They never sit on the canvas as a
 * wired step — other nodes reference them via a dropdown in their own edit
 * dialog, and Node-RED deduplicates them: two nodes pointing at "the same"
 * server config share one instance rather than each holding their own copy.
 *
 * WHY CREDENTIALS ARE SEPARATE FROM CONFIG
 * `apiKey` below is declared through the THIRD argument to
 * RED.nodes.registerType, not through `defaults`. That is the only field on
 * this node Node-RED encrypts at rest and strips out of flow exports — so
 * sharing a flow, or checking it into git, never leaks the key. Anything in
 * `defaults` is plain text in the flow file, which is fine for a hostname
 * but never for a secret. This is the ONLY correct place for secrets on a
 * Node-RED node.
 */

import type { Node, NodeAPI, NodeDef } from 'node-red';
import net from 'net';

const NODE_TYPE = 'jfpdemo-server-config';
const CONNECT_TIMEOUT_MS = 2000;

interface ServerConfigDef extends NodeDef {
  host: string;
  port: string | number;
}

/** The credential shape passed as the third argument to registerType, below. */
interface ServerConfigCredentials {
  apiKey?: string;
}

type ServerConfigNodeInstance = Node<ServerConfigCredentials> & {
  host: string;
  port: number;
};

module.exports = function (RED: NodeAPI) {
  function ServerConfigNode(this: Node<ServerConfigCredentials>, config: ServerConfigDef) {
    RED.nodes.createNode(this, config);
    const node = this as ServerConfigNodeInstance;
    node.host = config.host;
    node.port = Number(config.port);
  }

  // Generics spelled out explicitly: left to inference, TypeScript widens
  // the credentials object below to `{ apiKey: unknown }` instead of
  // matching it back to ServerConfigCredentials.
  RED.nodes.registerType<Node<ServerConfigCredentials>, ServerConfigDef, {}, ServerConfigCredentials>(
    NODE_TYPE,
    ServerConfigNode,
    {
      credentials: {
        // Registered here, not in `defaults` above — see the header comment.
        apiKey: { type: 'password' },
      },
    },
  );

  /**
   * Admin route the editor's "Test connection" button calls.
   *
   * EVERY httpAdmin route needs its own explicit needsPermission — Node-RED
   * does not add auth for you just because a route lives under
   * RED.httpAdmin. Omit this and the route is reachable by anyone who can
   * reach the editor, whether or not they are allowed to use it.
   */
  RED.httpAdmin.get(
    `/${NODE_TYPE}/:id/test`,
    RED.auth.needsPermission(`${NODE_TYPE}.read`),
    (req, res) => {
      const node = RED.nodes.getNode(String(req.params.id)) as ServerConfigNodeInstance | undefined;

      // The route is keyed by node id, so it only exists to test a config
      // node that has actually been deployed at least once. A node that was
      // only just dropped on the canvas has an id the editor knows about but
      // the runtime does not yet.
      if (!node) {
        res.status(404).json({ error: 'not-deployed' });
        return;
      }

      // A real TCP reachability check — no mocked result. The editor cannot
      // verify this itself; only the runtime, which actually has network
      // access to the print server, can.
      const socket = net.connect({ host: node.host, port: node.port });
      let settled = false;

      const finish = (ok: boolean, error?: string) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        res.json(error ? { ok, error } : { ok });
      };

      socket.setTimeout(CONNECT_TIMEOUT_MS);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false, `Timed out after ${CONNECT_TIMEOUT_MS}ms`));
      socket.once('error', (err: Error) => finish(false, err.message));
    },
  );
};
