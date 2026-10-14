import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** OpenAI Responses APIの`type: 'function'`ツール定義と同じフラットな形(Chat Completionsの
 * 入れ子の`function: {...}`形式とは異なる)。MCPの`tools/list`結果(JSON Schema)をそのまま
 * `parameters`へ渡せる。 */
export interface McpOpenAiFunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict: boolean;
}

export interface McpToolCallResult {
  text: string;
  isError: boolean;
}

export interface HertaMcpConnection {
  tools: McpOpenAiFunctionTool[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolCallResult>;
  close: () => Promise<void>;
}

/**
 * client/serverを同一プロセス内の`InMemoryTransport`で接続する(子プロセスspawnやstdio/HTTP
 * は使わない)。Phase 1は「MCPのtool discovery/invocationループが安全に通る」ことの実証が
 * 目的で、将来的に外部化する場合もtransportだけ差し替えればよい設計にしている。
 */
export async function connectHertaToolsMcpClient(server: McpServer): Promise<HertaMcpConnection> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'herta-bot', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  const openAiTools: McpOpenAiFunctionTool[] = tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }));

  return {
    tools: openAiTools,
    callTool: async (name, args) => {
      const result: unknown = await client.callTool({ name, arguments: args });
      const content = isRecord(result) && Array.isArray(result['content']) ? result['content'] : [];
      const text = content
        .filter(
          (item): item is { type: 'text'; text: string } =>
            isRecord(item) && item['type'] === 'text' && typeof item['text'] === 'string',
        )
        .map((item) => item.text)
        .join('\n');
      const isError = isRecord(result) && result['isError'] === true;
      return { text, isError };
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
