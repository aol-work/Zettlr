import type { ToolSchema, ToolHandler } from './types'
import { getFileId, getFileDisplayTitle } from './common'
import type { MDFileDescriptor } from '@dts/common/fsal'

/**
 * Returns search results from fsal.findExact, i.e., results that include the
 * search term in the filename. Both id and filename searches are supported,
 * depending on the passed parameters.
 *
 * @param   {string}     searchTerms  The search terms to search for
 * @param   {boolean}    includeTitle Whether to include title searches
 * @param   {boolean}    includeH1 Whether to include first heading searches
 * @param   {any}        workspaces   The workspace provider to use
 *
 * @return  {MDFileDescriptor[]}      The search results
 */
function searchExact (searchTerms: string, includeTitle: boolean, includeH1: boolean, workspaces: any): MDFileDescriptor[] {
  const queries = searchTerms.toLowerCase().split(' ').filter(q => q.trim() !== '')
  const allFiles = workspaces.getAllFiles().filter((file: any) => file.type === 'file') as MDFileDescriptor[]

  return allFiles.filter((file: MDFileDescriptor) => isFileMatching(file, queries, includeTitle, includeH1))

  function isFileMatching (fileDescriptor: MDFileDescriptor, queries: string[], includeTitle: boolean, includeH1: boolean): boolean {
    let allQueriesMatched = true

    for (let q of queries) {
      let queryMatched = false

      if (fileDescriptor.name.toLowerCase().includes(q)) {
        queryMatched = true
      }

      if (q.startsWith('#')) {
        const tagMatch = fileDescriptor.tags.find((tag: any) => typeof tag === 'string' && tag.includes(q.substr(1)))
        if (tagMatch !== undefined) {
          queryMatched = true
        }
      }

      const hasFrontmatter = fileDescriptor.frontmatter != null
      const hasTitle = hasFrontmatter && 'title' in fileDescriptor.frontmatter

      if (includeTitle && hasTitle && String(fileDescriptor.frontmatter.title).toLowerCase().includes(q)) {
        queryMatched = true
      }

      if (includeH1 && fileDescriptor.firstHeading !== null) {
        if (fileDescriptor.firstHeading.toLowerCase().includes(q)) {
          queryMatched = true
        }
      }

      if (!queryMatched) {
        allQueriesMatched = false
        break
      }
    }

    return allQueriesMatched
  }
}



export const zettlrSearchTitleSchema: ToolSchema = {
  name: 'zettlr_search_title',
  description: 'Search Zettlr files by title, filename, or H1 heading. Uses AND logic for multiple terms.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search terms to match against file titles. Multiple terms are treated with AND logic (all must match).'
      },
      maxResults: {
        type: 'integer',
        description: 'Maximum number of results to return (default: 50)',
        minimum: 1,
        maximum: 1000,
        default: 50
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
      totalResults: {
        type: 'number',
        description: 'Total number of matching files found'
      },
      files: {
        type: 'array',
        description: 'Array of matching files',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'File title (from YAML frontmatter, H1 heading, or filename)'
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
            modifiedDate: {
              type: 'string',
              description: 'File modification date in ISO format'
            },
            createdDate: {
              type: 'string',
              description: 'File creation date in ISO format'
            },
            size: {
              type: 'number',
              description: 'File size in bytes'
            },
            tags: {
              type: 'array',
              description: 'File tags',
              items: {
                type: 'string'
              }
            }
          },
          required: ['title', 'path', 'name', 'modifiedDate', 'createdDate', 'size', 'tags']
        }
      }
    },
    required: ['query', 'totalResults', 'files']
  }
}

export const zettlrSearchTitleHandler: ToolHandler = async (args, context) => {
  try {
    const query = args.query as string
    const maxResults = (args.maxResults as number) || 50
    const includeYamlTitle = args.includeYamlTitle !== false
    const includeH1Heading = args.includeH1Heading !== false

    if (typeof query !== 'string' || query.trim() === '') {
      return {
        content: [{
          type: 'text',
          text: 'Error: Query must be a non-empty string'
        }],
        isError: true
      }
    }

    context.logger.verbose(`[MCP] Searching files by title for: "${query}"`)

    const matchingFiles = searchExact(query, includeYamlTitle, includeH1Heading, context.workspaces)
    const limitedFiles = matchingFiles.slice(0, maxResults)
    const files = limitedFiles.map((file: MDFileDescriptor) => {
              const fileTitle = getFileDisplayTitle(file)
      const fileId = getFileId(file.path, context)

      return {
        title: fileTitle,
        path: file.path,
        name: file.name,
        id: fileId !== '' ? fileId : undefined,
        modifiedDate: new Date(file.modtime).toISOString(),
        createdDate: new Date(file.creationtime).toISOString(),
        size: file.size,
        tags: file.tags ?? []
      }
    })

    const result = {
      query,
      totalResults: matchingFiles.length,
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
    context.logger.error('[MCP] Error in title search:', error)
    return {
      content: [{
        type: 'text',
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }],
      isError: true
    }
  }
}
