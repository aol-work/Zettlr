import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { app } from 'electron'
import express from 'express'
import type LogProvider from '../log'

// Map to store active SSE transports by their session IDs
const sseTransports = new Map<string, SSEServerTransport>()

export default class MCPProvider {
  private server: McpServer | undefined
  private expressApp: express.Application
  private httpServer: ReturnType<express.Application['listen']> | undefined
  private readonly _logger: LogProvider

  constructor (logger: LogProvider) {
    this._logger = logger
    this.server = undefined
    this.expressApp = express()
    this.httpServer = undefined

    /** ─────────────── middleware ─────────────── **/
    this.expressApp.use(express.json())

    // Legacy SSE endpoint for older clients
    this.expressApp.get('/sse', async (req, res) => {
      console.log(`[SSE] New connection request from ${req.ip}`)

      const transport = new SSEServerTransport('/messages', res)
      sseTransports.set(transport.sessionId, transport)
      console.log(`[SSE] Created new transport with sessionId: ${transport.sessionId}`)

      res.on('close', () => {
        console.log(`[SSE] Connection closed for sessionId: ${transport.sessionId}`)
        sseTransports.delete(transport.sessionId)
      })

      await this.server?.connect(transport)
      console.log(`[SSE] Server connected to transport for sessionId: ${transport.sessionId}`)
    })

    // Legacy message endpoint for older clients
    this.expressApp.post('/messages', async (req, res) => {
      const sessionId = req.query.sessionId as string
      console.log(`[Messages] Received message for sessionId: ${sessionId}`)

      const transport = sseTransports.get(sessionId)
      if (transport !== undefined) {
        console.log(`[Messages] Processing message for sessionId: ${sessionId}`)
        await transport.handlePostMessage(req, res, req.body)
        console.log(`[Messages] Message processed for sessionId: ${sessionId}`)
      } else {
        console.log(`[Messages] Error: No transport found for sessionId: ${sessionId}`)
        res.status(400).send('No transport found for sessionId')
      }
    })
  }

  /** ─────────────── boot / shutdown ─────────────── **/
  async boot (): Promise<void> {
    this._logger.verbose('MCP provider booting up …')

    this.server = new McpServer({
      name: 'zettlr-mcp',
      version: app.getVersion()
    })

    this.server.resource(
      'version',
      new ResourceTemplate('zettlr://version', { list: undefined }),
      async (uri) => ({
        contents: [{
          uri: uri.href,
          text: JSON.stringify({ version: app.getVersion() }),
          mimeType: 'application/json'
        }]
      })
    )

    this.server.tool(
      'get-zettlr-version',
      {},
      async () => ({
        content: [{
          type: 'text',
          text: app.getVersion()
        }]
      })
    )

    const PORT = 3001
    this.httpServer = this.expressApp.listen(PORT, () =>
      this._logger.verbose(`MCP Streamable HTTP Server listening on port ${PORT}`)
    )
  }

  async shutdown (): Promise<void> {
    if (this.httpServer) {
      this._logger.verbose('Shutting down MCP HTTP server …')
      await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()))
      this.httpServer = undefined
    }
    if (this.server) {
      this._logger.verbose('Shutting down MCP server …')
      this.server = undefined
    }
  }
}
