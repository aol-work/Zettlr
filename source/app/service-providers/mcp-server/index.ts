import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { app } from 'electron'
import express from 'express'
import path from 'path'
import { promises as fs } from 'fs'
import type LogProvider from '../log'
import type ConfigProvider from '../config'
import type FSAL from '../fsal'
import { allToolSchemas, toolHandlers, type ToolContext } from './tools'

function readToggleEnv (envVarName: string, defaultValue: boolean): { enabled: boolean, raw: string | undefined, valid: boolean } {
  const raw = process.env[envVarName]
  if (raw === undefined || raw.trim() === '') {
    return { enabled: defaultValue, raw, valid: true }
  }

  const norm = raw.trim().toLowerCase()
  if ([ '1', 'true', 'yes', 'y', 'on', 'enable', 'enabled' ].includes(norm)) {
    return { enabled: true, raw, valid: true }
  }
  if ([ '0', 'false', 'no', 'n', 'off', 'disable', 'disabled' ].includes(norm)) {
    return { enabled: false, raw, valid: true }
  }

  return { enabled: defaultValue, raw, valid: false }
}

export default class MCPProvider {
  private server: McpServer | undefined
  private expressApp: express.Application
  private httpServer: ReturnType<express.Application['listen']> | undefined
  private udsServer: ReturnType<express.Application['listen']> | undefined
  private udsPath: string | undefined
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
    this.udsServer = undefined
    this.udsPath = undefined

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

    const httpToggle = readToggleEnv('ZETTLR_MCP_HTTP', true)
    const udsToggle = readToggleEnv('ZETTLR_MCP_UDS', true)

    if (!httpToggle.valid) {
      this._logger.warning(`[MCP] Invalid value for ZETTLR_MCP_HTTP="${httpToggle.raw!}". Using default: enabled.`)
    }
    if (!udsToggle.valid) {
      this._logger.warning(`[MCP] Invalid value for ZETTLR_MCP_UDS="${udsToggle.raw!}". Using default: enabled.`)
    }

    if (!httpToggle.enabled && !udsToggle.enabled) {
      this._logger.warning('[MCP] Both transports are disabled (ZETTLR_MCP_HTTP=0 and ZETTLR_MCP_UDS=0). MCP server will not be reachable.')
      return
    }

    // SECURITY: Never bind the MCP HTTP server to anything but the local loopback
    // interface. Express will otherwise bind to all interfaces (0.0.0.0),
    // which would expose the MCP endpoints to the LAN.
    if (httpToggle.enabled) {
      const HOST = '127.0.0.1'
      const PORT = 3001
      this.httpServer = this.expressApp.listen(PORT, HOST, () => {
        this._logger.verbose(`MCP HTTP listening on http://${HOST}:${PORT}`)
      })
    } else {
      this._logger.info('[MCP] HTTP transport disabled via ZETTLR_MCP_HTTP=0')
    }

    // UDS transport (HTTP over Unix Domain Socket), useful for local-only clients.
    // Note: Not available on Windows.
    if (udsToggle.enabled) {
      if (process.platform === 'win32') {
        this._logger.warning('[MCP] UDS transport requested, but is not supported on Windows. Skipping.')
      } else {
        const defaultSockPath = path.join(app.getPath('userData'), 'zettlr-mcp.sock')
        const sockPath = (process.env.ZETTLR_MCP_UDS_PATH !== undefined && process.env.ZETTLR_MCP_UDS_PATH.trim() !== '')
          ? process.env.ZETTLR_MCP_UDS_PATH.trim()
          : defaultSockPath

        // Ensure we don't clobber a non-socket file.
        try {
          const st = await fs.lstat(sockPath)
          if (st.isSocket()) {
            await fs.unlink(sockPath)
          } else {
            throw new Error(`UDS path exists and is not a socket: ${sockPath}`)
          }
        } catch (err: any) {
          if (err?.code !== 'ENOENT') {
            throw err
          }
        }

        this.udsPath = sockPath
        this.udsServer = this.expressApp.listen(sockPath, async () => {
          // Restrict access: owner read/write only (best-effort).
          try {
            await fs.chmod(sockPath, 0o600)
          } catch (err) {
            this._logger.warning(`[MCP] Could not chmod UDS socket to 0600: ${(err as Error).message}`)
          }
          this._logger.verbose(`MCP UDS listening on unix:${sockPath}`)
        })
      }
    } else {
      this._logger.info('[MCP] UDS transport disabled via ZETTLR_MCP_UDS=0')
    }
  }

  async shutdown (): Promise<void> {
    if (this.httpServer) {
      this._logger.verbose('Shutting down MCP HTTP server …')
      await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()))
      this.httpServer = undefined
    }
    if (this.udsServer) {
      this._logger.verbose('Shutting down MCP UDS server …')
      await new Promise<void>((resolve) => this.udsServer?.close(() => resolve()))
      this.udsServer = undefined
      if (this.udsPath !== undefined) {
        try {
          await fs.unlink(this.udsPath)
        } catch (err: any) {
          // Ignore missing socket file.
          if (err?.code !== 'ENOENT') {
            this._logger.warning(`[MCP] Could not remove UDS socket file: ${err.message as string}`)
          }
        } finally {
          this.udsPath = undefined
        }
      }
    }
    if (this.server) {
      this._logger.verbose('Shutting down MCP server …')
      this.server = undefined
    }
  }
}
