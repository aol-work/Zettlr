import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { app } from 'electron'
import express from 'express'
import type LogProvider from '../log'
import type ConfigProvider from '../config'
import type FSAL from '../fsal'
import { allToolSchemas, toolHandlers, type ToolContext } from './tools'

export default class MCPProvider {
  private server: McpServer | undefined
  private expressApp: express.Application
  private httpServer: ReturnType<express.Application['listen']> | undefined
  private readonly _logger: LogProvider
  private readonly _config: ConfigProvider
  private readonly _fsal: FSAL

  constructor (logger: LogProvider, config: ConfigProvider, fsal: FSAL) {
    this._logger = logger
    this._config = config
    this._fsal = fsal
    this.server = undefined
    this.expressApp = express()
    this.httpServer = undefined

    this.expressApp.use(express.json())
    this.expressApp.get('/message', async (req, res) => {
      this._logger.verbose('[MCP] GET /message - initiating SSE stream')

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Cache-Control'
      })

      res.write('event: message\n')
      res.write(`data: ${JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      })}\n\n`)

      const keepAlive = setInterval(() => {
        res.write(': keepalive\n\n')
      }, 30000)

      req.on('close', () => {
        clearInterval(keepAlive)
        this._logger.verbose('[MCP] SSE connection closed')
      })
    })

    this.expressApp.post('/message', async (req, res) => {
      this._logger.verbose('[MCP] POST /message - handling JSON-RPC request')

      try {
        const message = req.body
        this._logger.verbose(`[MCP] Received message: ${JSON.stringify(message)}`)

        if (message.method === 'initialize') {
          res.json({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: {
                tools: {},
                resources: {}
              },
              serverInfo: {
                name: 'zettlr-mcp',
                version: app.getVersion()
              }
            }
          })
        } else if (message.method === 'tools/list') {
          res.json({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: allToolSchemas
            }
          })
        } else if (message.method === 'tools/call') {
          const { name, arguments: args } = message.params

          const context: ToolContext = {
            logger: this._logger,
            fsal: this._fsal
          }

          const handler = toolHandlers[name as keyof typeof toolHandlers]
          if (handler !== undefined) {
            try {
              const result = await handler(args, context)
              res.json({
                jsonrpc: '2.0',
                id: message.id,
                result
              })
            } catch (error) {
              this._logger.error(`[MCP] Error in tool ${name}:`, error)
              res.json({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                  content: [{
                    type: 'text',
                    text: `Error in tool ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`
                  }],
                  isError: true
                }
              })
            }
          } else {
            res.json({
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32601,
                message: `Method '${name}' not found`
              }
            })
          }
        } else {
          res.json({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32601,
              message: `Method '${message.method}' not found`
            }
          })
        }
      } catch (error) {
        this._logger.error('[MCP] Error handling message:', error)
        res.status(500).json({
          jsonrpc: '2.0',
          id: req.body?.id,
          error: {
            code: -32603,
            message: 'Internal error'
          }
        })
      }
    })

    this.expressApp.options('/message', (req, res) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type, Cache-Control')
      res.sendStatus(200)
    })
  }

  async boot (): Promise<void> {
    this._logger.verbose('MCP provider booting up …')

    // SECURITY: Never bind the MCP server to anything but the local loopback
    // interface. Express will otherwise bind to all interfaces (0.0.0.0),
    // which would expose the MCP endpoints to the LAN.
    const HOST = '127.0.0.1'
    const PORT = 3001
    this.httpServer = this.expressApp.listen(PORT, HOST, () => {
      this._logger.verbose(`MCP Streamable HTTP Server listening on http://${HOST}:${PORT}`)
    })
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
