import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

// The MCP session manager against a client that is only a stub: which failures drop a
// session so the next call connects again, which keep it, and what a connect that fails
// half-way leaves behind. No network, no process, no database.

type Reply = { content: { type: "text"; text: string }[] };
class FakeClient {
  closed = false;
  /** What the next `callTool` does; the default answers. */
  next: (() => Promise<Reply>) | null = null;
  constructor(readonly listing: () => Promise<{ tools: unknown[] }>) {}
  listTools() {
    return this.listing();
  }
  callTool(): Promise<Reply> {
    const run = this.next;
    this.next = null;
    return run ? run() : Promise.resolve({ content: [] });
  }
  async close() {
    this.closed = true;
  }
}
let clients: FakeClient[] = [];
/** How the next client lists its tools; reset after each test. */
let listing: () => Promise<{ tools: unknown[] }> = async () => ({ tools: [] });
class UnauthorizedError extends Error {}

mock.module("@ai-sdk/mcp", {
  namedExports: {
    UnauthorizedError,
    auth: async () => "AUTHORIZED",
    createMCPClient: async () => {
      const client = new FakeClient(listing);
      clients.push(client);
      return client;
    },
  },
});
mock.module("@ai-sdk/mcp/mcp-stdio", {
  namedExports: { Experimental_StdioMCPTransport: class {} },
});
const errors: string[] = [];
mock.module("../features/connectors/mcp.query.ts", {
  namedExports: {
    findServer: async (name: string) => ({
      name,
      config: { command: "server", args: [] },
      oauth: null,
    }),
    findServerByOAuthState: async () => null,
    saveConnectionError: async (_name: string, message: string) => {
      errors.push(message);
    },
    saveOAuthData: async () => {},
    syncServerTools: async () => {},
  },
});

const { mcpManager } = await import("../features/connectors/mcp.manager.ts");

afterEach(async () => {
  await mcpManager.dispose();
  clients = [];
  errors.length = 0;
  listing = async () => ({ tools: [] });
});

test("a call the connection did not carry drops the session, and the next one connects again", async () => {
  await mcpManager.callTool("files", "read");
  assert.equal(clients.length, 1);
  clients[0].next = () => Promise.reject(new Error("Connection closed"));
  await assert.rejects(mcpManager.callTool("files", "read"), /closed/);
  assert.equal(clients[0].closed, true);
  await mcpManager.callTool("files", "read");
  assert.equal(clients.length, 2);
});

test("a system error's string code is not the server's answer", async () => {
  await mcpManager.callTool("files", "read");
  clients[0].next = () =>
    Promise.reject(Object.assign(new Error("read"), { code: "ECONNRESET" }));
  await assert.rejects(mcpManager.callTool("files", "read"));
  assert.equal(clients[0].closed, true);
});

test("the server's own refusal keeps the session", async () => {
  await mcpManager.callTool("files", "read");
  clients[0].next = () =>
    Promise.reject(
      Object.assign(new Error("Invalid params"), { code: -32602 }),
    );
  await assert.rejects(mcpManager.callTool("files", "read"), /Invalid params/);
  assert.equal(clients[0].closed, false);
  await mcpManager.callTool("files", "read");
  assert.equal(clients.length, 1);
});

test("a call the caller stopped keeps the session", async () => {
  await mcpManager.callTool("files", "read");
  const stop = new AbortController();
  clients[0].next = () => {
    stop.abort();
    return Promise.reject(new Error("Request was aborted"));
  };
  await assert.rejects(
    mcpManager.callTool("files", "read", {}, stop.signal),
    /aborted/,
  );
  assert.equal(clients[0].closed, false);
});

test("a failure on an older client leaves the session that replaced it", async () => {
  await mcpManager.callTool("files", "read");
  let fail: (cause: Error) => void = () => {};
  clients[0].next = () =>
    new Promise<Reply>((_resolve, reject) => {
      fail = reject;
    });
  const slow = mcpManager.callTool("files", "read");
  await new Promise((resolve) => setImmediate(resolve));
  await mcpManager.connect("files");
  assert.equal(clients.length, 2);
  fail(new Error("Connection closed"));
  await assert.rejects(slow);
  assert.equal(clients[1].closed, false);
  await mcpManager.callTool("files", "read");
  assert.equal(clients.length, 2);
});

test("a server that connects and cannot list its tools has its client closed", async () => {
  listing = () => Promise.reject(new Error("Server does not support tools"));
  await assert.rejects(mcpManager.connect("files"), /does not support tools/);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].closed, true);
  assert.deepEqual(errors, ["Server does not support tools"]);
});
