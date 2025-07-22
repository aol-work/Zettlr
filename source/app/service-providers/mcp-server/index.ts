import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { app } from 'electron'
import express from 'express'
import { readFile } from 'fs/promises'
import type LogProvider from '../log'
import type WorkspaceProvider from '../workspaces'
import type { MDFileDescriptor, AnyDescriptor } from '@dts/common/fsal'

/**
 * Returns a function that can be used as a filter to match file descriptors against a query.
 * This replicates Zettlr's quick filter logic for title search.
 *
 * @param   {string}    query                   The query string to match against.
 * @param   {boolean}   includeTitle            Whether or not to include YAML titles
 * @param   {boolean}   includeH1               Whether or not to include headings level 1
 *
 * @return  {(item: AnyDescriptor) => boolean}  The filter function.
 */
function matchQuery(query: string, includeTitle: boolean, includeH1: boolean): (item: AnyDescriptor) => boolean {
  const queries = query.split(' ').map(q => q.trim()).filter(q => q !== '')

  return function (item: AnyDescriptor): boolean {
    // Only match files, not directories
    if (item.type !== 'file') {
      return false
    }

    let allQueriesMatched = true

    for (const q of queries.map(term => term.toLowerCase())) {
      let queryMatched = false

      // First, see if the filename gives a match
      if (item.name.toLowerCase().includes(q)) {
        queryMatched = true
      }

      const fileDescriptor = item as MDFileDescriptor

      // If the query only consists of a "#" also include files that contain tags
      if (q === '#' && fileDescriptor.tags.length > 0) {
        queryMatched = true
      }

      // Let's check for tag matches
      if (q.startsWith('#')) {
        const tagMatch = fileDescriptor.tags.find(tag => tag.includes(q.substr(1)))
        if (tagMatch !== undefined) {
          queryMatched = true
        }
      }

      const hasFrontmatter = fileDescriptor.frontmatter != null
      const hasTitle = hasFrontmatter && 'title' in fileDescriptor.frontmatter

      // Does the YAML frontmatter title match?
      if (includeTitle && hasTitle && String(fileDescriptor.frontmatter.title).toLowerCase().includes(q)) {
        queryMatched = true
      }

      // Should we use headings 1 and, if so, does it match?
      if (includeH1 && fileDescriptor.firstHeading !== null) {
        if (fileDescriptor.firstHeading.toLowerCase().includes(q)) {
          queryMatched = true
        }
      }

      // If any of the queries are not matched, set allQueriesMatched to false
      if (!queryMatched) {
        allQueriesMatched = false
        break // No need to continue checking other queries if one is not matched
      }
    }

    return allQueriesMatched
  }
}

/**
 * Gets the display title for a file, preferring YAML title, then H1 heading, then filename
 *
 * @param   {MDFileDescriptor}  file  The file descriptor
 *
 * @return  {string}                  The display title
 */
function getFileDisplayTitle(file: MDFileDescriptor): string {
  // Prefer YAML title from frontmatter
  if (file.yamlTitle !== undefined) {
    return file.yamlTitle
  }

  // Then first H1 heading
  if (file.firstHeading !== null) {
    return file.firstHeading
  }

  // Finally, just the filename
  return file.name
}

export default class MCPProvider {
  private server: McpServer | undefined
  private expressApp: express.Application
  private httpServer: ReturnType<express.Application['listen']> | undefined
  private readonly _logger: LogProvider
  private readonly _workspaces: WorkspaceProvider

  constructor(logger: LogProvider, workspaces: WorkspaceProvider) {
    this._logger = logger
    this._workspaces = workspaces
    this.server = undefined
    this.expressApp = express()
    this.httpServer = undefined

    /** ─────────────── middleware ─────────────── **/
    this.expressApp.use(express.json())

    // Streamable HTTP endpoint for new transport
    this.expressApp.get('/message', async (req, res) => {
      this._logger.verbose('[MCP] GET /message - initiating SSE stream')

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Cache-Control'
      })

      // Send initial ready event
      res.write('event: message\n')
      res.write(`data: ${JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      })}\n\n`)

      // Keep the connection alive
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
              protocolVersion: '2024-11-05',
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
              tools: [
                {
                  name: 'get-zettlr-version',
                  description: 'Get the version of Zettlr',
                  inputSchema: {
                    type: 'object',
                    properties: {},
                    required: []
                  }
                },
                {
                  name: 'zettlr_search_title',
                  description: 'Search Zettlr files by title, filename, or H1 heading. Uses AND logic for multiple terms.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      query: {
                        type: 'string',
                        description: 'Search terms to match against file titles. Multiple terms are treated with AND logic (all must match).'
                      },
                      includeYamlTitle: {
                        type: 'boolean',
                        description: 'Whether to include YAML frontmatter title in search (default: true)',
                        default: true
                      },
                      includeH1Heading: {
                        type: 'boolean',
                        description: 'Whether to include first H1 heading in search (default: true)',
                        default: true
                      },
                      maxResults: {
                        type: 'integer',
                        description: 'Maximum number of results to return (default: 50)',
                        default: 50,
                        minimum: 1,
                        maximum: 1000
                      }
                    },
                    required: ['query']
                  }
                },
                {
                  name: 'zettlr_read_file',
                  description: 'Read the full contents of a specified file. Allows retrieving the complete text of a note after identifying it via search tools.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      path: {
                        type: 'string',
                        description: 'The file path to read. Can be an absolute path or relative path within the workspace.'
                      }
                    },
                    required: ['path']
                  }
                }
              ]
            }
          })
        } else if (message.method === 'tools/call') {
          const { name, arguments: args } = message.params

          if (name === 'get-zettlr-version') {
            res.json({
              jsonrpc: '2.0',
              id: message.id,
              result: {
                content: [{
                  type: 'text',
                  text: app.getVersion()
                }]
              }
            })
          } else if (name === 'zettlr_search_title') {
            // Handle search tool
            const query = args.query as string
            const includeYamlTitle = typeof args.includeYamlTitle === 'boolean' ? args.includeYamlTitle : true
            const includeH1Heading = typeof args.includeH1Heading === 'boolean' ? args.includeH1Heading : true
            const maxResults = typeof args.maxResults === 'number' ? Math.min(Math.max(args.maxResults, 1), 1000) : 50

            if (typeof query !== 'string' || query.trim() === '') {
              res.json({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                  content: [{
                    type: 'text',
                    text: 'Error: Query must be a non-empty string'
                  }]
                }
              })
              return
            }

            try {
              // Get all files from all workspaces
              const allFiles = this._workspaces.getAllFiles()
                .filter((file): file is MDFileDescriptor => file.type === 'file')

              // Create the filter function
              const filter = matchQuery(query.trim(), includeYamlTitle, includeH1Heading)

              // Apply the filter and limit results
              const matchingFiles = allFiles
                .filter(filter)
                .slice(0, maxResults)
                .map(file => ({
                  title: getFileDisplayTitle(file),
                  path: file.path,
                  name: file.name,
                  yamlTitle: file.yamlTitle,
                  firstHeading: file.firstHeading,
                  wordCount: file.wordCount,
                  modtime: new Date(file.modtime).toISOString()
                }))

              const resultText = matchingFiles.length > 0
                ? `Found ${matchingFiles.length} file(s) matching "${query}":\n\n` +
                matchingFiles.map(file =>
                  `• ${file.title}${file.title !== file.name ? ` (${file.name})` : ''}\n` +
                  `  Path: ${file.path}\n` +
                  `  Words: ${file.wordCount}, Modified: ${file.modtime}`
                ).join('\n\n')
                : `No files found matching "${query}"`

              res.json({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                  content: [{
                    type: 'text',
                    text: resultText
                  }]
                }
              })
            } catch (error) {
              this._logger.error('[MCP] Error in title search:', error)
              res.json({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                  content: [{
                    type: 'text',
                    text: `Error performing search: ${error instanceof Error ? error.message : 'Unknown error'}`
                  }]
                }
              })
            }
          } else if (name === 'zettlr_read_file') {
            // Handle read file tool
            const filePath = args.path as string

            if (typeof filePath !== 'string' || filePath.trim() === '') {
              res.json({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                  content: [{
                    type: 'text',
                    text: 'Error: Path must be a non-empty string'
                  }]
                }
              })
              return
            }

            try {
              // Get all files to validate the path exists in our workspace
              const allFiles = this._workspaces.getAllFiles()
              const fileDescriptor = allFiles.find(file => file.path === filePath)

              if (!fileDescriptor) {
                res.json({
                  jsonrpc: '2.0',
                  id: message.id,
                  result: {
                    content: [{
                      type: 'text',
                      text: `Error: File not found at path "${filePath}". Make sure the file exists in the current workspace.`
                    }]
                  }
                })
                return
              }

              // Only allow reading text files
              if (fileDescriptor.type !== 'file') {
                res.json({
                  jsonrpc: '2.0',
                  id: message.id,
                  result: {
                    content: [{
                      type: 'text',
                      text: `Error: "${filePath}" is not a file`
                    }]
                  }
                })
                return
              }

              // Read the file content
              const fileContent = await readFile(filePath, 'utf8')

              res.json({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                  content: [{
                    type: 'text',
                    text: fileContent
                  }]
                }
              })
            } catch (error) {
              this._logger.error('[MCP] Error reading file:', error)
              res.json({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                  content: [{
                    type: 'text',
                    text: `Error reading file "${filePath}": ${error instanceof Error ? error.message : 'Unknown error'}`
                  }]
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

    // Handle CORS preflight requests
    this.expressApp.options('/message', (req, res) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type, Cache-Control')
      res.sendStatus(200)
    })
  }

  /** ─────────────── boot / shutdown ─────────────── **/
  async boot(): Promise<void> {
    this._logger.verbose('MCP provider booting up …')

    const PORT = 3001
    this.httpServer = this.expressApp.listen(PORT, () =>
      this._logger.verbose(`MCP Streamable HTTP Server listening on port ${PORT}`)
    )
  }

  async shutdown(): Promise<void> {
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
