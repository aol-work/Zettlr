import type { ToolSchema, ToolHandler } from './types'
import compileSearchTerms from '@common/util/compile-search-terms'
import { getFileId, getFileDisplayTitle } from './common'
import type { AnyDescriptor, MDFileDescriptor, CodeFileDescriptor } from '@dts/common/fsal'
import type { SearchTerm, SearchResult } from '@dts/common/search'



export const zettlrSearchKeywordSchema: ToolSchema = {
  name: 'zettlr_search_keyword',
  description: 'Search through the full text content of all Zettlr files. Supports AND, OR, NOT operators. Returns matching lines with context snippets.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query. Supports operators: AND (space), OR (|), NOT (!), exact phrases ("phrase"). Example: "machine learning" OR AI !deprecated'
      },
      maxResults: {
        type: 'integer',
        description: 'Maximum number of files to return results for (default: 50)',
        default: 50,
        minimum: 1,
        maximum: 1000
      },
      maxSnippetsPerFile: {
        type: 'integer',
        description: 'Maximum number of matching snippets to show per file (default: 10)',
        default: 10,
        minimum: 1,
        maximum: 50
      }
    },
    required: ['query']
  },
  outputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query that was used'
      },
      totalFiles: {
        type: 'number',
        description: 'Total number of files with matches'
      },
      totalMatches: {
        type: 'number',
        description: 'Total number of matching text snippets across all files'
      },
      files: {
        type: 'array',
        description: 'Array of files containing matches',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'File title or display name'
            },
            path: {
              type: 'string',
              description: 'Full file path'
            },
            name: {
              type: 'string',
              description: 'File name with extension'
            },
            id: {
              type: 'string',
              description: 'File identifier (if available)'
            },
            type: {
              type: 'string',
              description: 'File type'
            },
            relevance: {
              type: 'number',
              description: 'Relevance score for this file'
            },
            matchCount: {
              type: 'number',
              description: 'Number of matching snippets in this file'
            },
            snippets: {
              type: 'array',
              description: 'Array of matching text snippets',
              items: {
                type: 'object',
                properties: {
                  line: {
                    type: 'number',
                    description: 'Line number where match was found'
                  },
                  text: {
                    type: 'string',
                    description: 'Text snippet containing the match'
                  },
                  relevance: {
                    type: 'number',
                    description: 'Relevance score for this snippet'
                  },
                  ranges: {
                    type: 'array',
                    description: 'Character ranges of matches within the snippet'
                  }
                },
                required: [ 'line', 'text', 'relevance', 'ranges' ]
              }
            },
            hasMoreMatches: {
              type: 'boolean',
              description: 'Whether there are more matches than shown in snippets'
            }
          },
          required: [ 'title', 'path', 'name', 'type', 'relevance', 'matchCount', 'snippets', 'hasMoreMatches' ]
        }
      }
    },
    required: [ 'query', 'totalFiles', 'totalMatches', 'files' ]
  }
}

export const zettlrSearchKeywordHandler: ToolHandler = async (args, context) => {
  const query = args.query as string
  const maxResultsArg: unknown = args.maxResults
  const maxResults = typeof maxResultsArg === 'number'
    ? Math.min(Math.max(maxResultsArg, 1), 1000)
    : 50
  const maxSnippetsPerFileArg: unknown = args.maxSnippetsPerFile
  const maxSnippetsPerFile = typeof maxSnippetsPerFileArg === 'number'
    ? Math.min(Math.max(maxSnippetsPerFileArg, 1), 50)
    : 10

  if (typeof query !== 'string' || query.trim() === '') {
    return {
      content: [{
        type: 'text',
        text: 'Error: Query must be a non-empty string'
      }],
      isError: true
    }
  }

  try {
    const searchTerms: SearchTerm[] = compileSearchTerms(query.trim())

    const allFiles = (await context.fsal.getAllLoadedDescriptors())
      .filter((file: AnyDescriptor): file is MDFileDescriptor | CodeFileDescriptor => 
        file.type === 'file' || file.type === 'code')

    const searchResults: Array<{ file: MDFileDescriptor | CodeFileDescriptor, results: SearchResult[], weight: number }> = []

    for (const file of allFiles) {
      try {
        const results: SearchResult[] = await context.fsal.searchFile(file, searchTerms)
        if (results.length > 0) {
          const totalWeight = results.reduce((sum, result) => sum + result.weight, 0)
          searchResults.push({ file, results, weight: totalWeight })
        }
      } catch (error) {
        context.logger.error(`[MCP] Error searching file ${file.path}:`, error)
      }
    }

    searchResults.sort((a, b) => b.weight - a.weight)
    const limitedResults = searchResults.slice(0, maxResults)
    const totalMatches = limitedResults.reduce((total, result) => total + result.results.length, 0)
    const files = limitedResults.map(({ file, results, weight }) => {
      const fileTitle = file.type === 'file' ? getFileDisplayTitle(file) : file.name
      const fileId = getFileId(file.type === 'file' ? file : undefined)

      const snippets = results.slice(0, maxSnippetsPerFile).map(result => ({
        line: result.line,
        text: result.restext,
        relevance: result.weight,
        ranges: result.ranges
      }))

      return {
        title: fileTitle,
        path: file.path,
        name: file.name,
        id: fileId || undefined,
        type: file.type,
        relevance: weight,
        matchCount: results.length,
        snippets,
        hasMoreMatches: results.length > maxSnippetsPerFile
      }
    })

    const result = {
      query: query.trim(),
      totalFiles: limitedResults.length,
      totalMatches,
      files
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }],
      structuredContent: result,
      isError: false
    }
  } catch (error) {
    context.logger.error('[MCP] Error in keyword search:', error)
    return {
      content: [{
        type: 'text',
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }],
      isError: true
    }
  }
}
