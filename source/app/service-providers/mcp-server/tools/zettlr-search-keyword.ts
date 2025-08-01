import type { ToolSchema, ToolHandler } from './types'
import compileSearchTerms from '@common/util/compile-search-terms'
import { getFileId } from './common'
import type { AnyDescriptor, MDFileDescriptor, CodeFileDescriptor } from '@dts/common/fsal'
import type { SearchTerm, SearchResult } from '@dts/common/search'

/**
 * Gets the display title for a file, preferring YAML title, then H1 heading, then filename
 *
 * @param   {MDFileDescriptor}  file  The file descriptor
 *
 * @return  {string}                  The display title
 */
function getFileDisplayTitle (file: MDFileDescriptor): string {
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
  }
}

export const zettlrSearchKeywordHandler: ToolHandler = async (args, context) => {
  const query = args.query as string
  const maxResults = typeof args.maxResults === 'number' ? Math.min(Math.max(args.maxResults, 1), 1000) : 50
  const maxSnippetsPerFile = typeof args.maxSnippetsPerFile === 'number' ? Math.min(Math.max(args.maxSnippetsPerFile, 1), 50) : 10

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
    // Compile the search terms using Zettlr's search term compiler
    const searchTerms: SearchTerm[] = compileSearchTerms(query.trim())

    // Get all files from all workspaces
    const allFiles = context.workspaces.getAllFiles()
      .filter((file: AnyDescriptor): file is MDFileDescriptor | CodeFileDescriptor => 
        file.type === 'file' || file.type === 'code')

    const searchResults: Array<{ file: MDFileDescriptor | CodeFileDescriptor, results: SearchResult[ ], weight: number }> = [ ]

    // Search each file using FSAL's search functionality
    for (const file of allFiles) {
      try {
        const results: SearchResult[] = await context.fsal.searchFile(file, searchTerms)
        if (results.length > 0) {
          const totalWeight = results.reduce((sum, result) => sum + result.weight, 0)
          searchResults.push({ file, results, weight: totalWeight })
        }
      } catch (error) {
        context.logger.error(`[MCP] Error searching file ${file.path}:`, error)
        // Continue with other files
      }
    }

    // Sort by weight (relevance) and limit results
    searchResults.sort((a, b) => b.weight - a.weight)
    const limitedResults = searchResults.slice(0, maxResults)

    const totalMatches = limitedResults.reduce((total, result) => total + result.results.length, 0)

    // Transform results to match output schema
    const files = limitedResults.map(({ file, results, weight }) => {
      const fileTitle = file.type === 'file' ? getFileDisplayTitle(file) : file.name
      const fileId = getFileId(file.path, context)

      // Limit snippets per file and extract relevant data
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
