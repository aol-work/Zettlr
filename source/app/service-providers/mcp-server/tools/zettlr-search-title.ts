import type { ToolSchema, ToolHandler, ToolContext } from './types'
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
function matchQuery (query: string, includeTitle: boolean, includeH1: boolean): (item: AnyDescriptor) => boolean {
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
}

export const zettlrSearchTitleHandler: ToolHandler = async (args: { query: string, includeYamlTitle: boolean, includeH1Heading: boolean, maxResults: number }, context: ToolContext) => {
  const query = args.query as string
  const includeYamlTitle = typeof args.includeYamlTitle === 'boolean' ? args.includeYamlTitle : true
  const includeH1Heading = typeof args.includeH1Heading === 'boolean' ? args.includeH1Heading : true
  const maxResults = typeof args.maxResults === 'number' ? Math.min(Math.max(args.maxResults, 1), 1000) : 50

  if (typeof query !== 'string' || query.trim() === '') {
    return {
      content: [{
        type: 'text',
        text: 'Error: Query must be a non-empty string'
      }]
    }
  }

  try {
    // Get all files from all workspaces
    const allFiles = context.workspaces.getAllFiles()
      .filter((file: AnyDescriptor): file is MDFileDescriptor => file.type === 'file')

    // Create the filter function
    const filter = matchQuery(query.trim(), includeYamlTitle, includeH1Heading)

    // Apply the filter and limit results
    const matchingFiles = allFiles
      .filter(filter)
      .slice(0, maxResults)
      .map((file: MDFileDescriptor) => ({
        title: getFileDisplayTitle(file),
        path: file.path,
        name: file.name,
        yamlTitle: file.yamlTitle,
        firstHeading: file.firstHeading,
        wordCount: file.wordCount,
        modtime: new Date(file.modtime ?? 0).toISOString()
      }))

    const resultText = matchingFiles.length > 0
      ? `Found ${matchingFiles.length} file(s) matching "${query}":\n\n` +
      matchingFiles.map(file =>
        `• ${file.title}${file.title !== file.name ? ` (${file.name})` : ''}\n` +
        `  Path: ${file.path}\n` +
        `  Words: ${file.wordCount}, Modified: ${file.modtime}`
      ).join('\n\n')
      : `No files found matching "${query}"`

    return {
      content: [{
        type: 'text',
        text: resultText
      }]
    }
  } catch (error) {
    context.logger.error('[MCP] Error in title search:', error)
    return {
      content: [{
        type: 'text',
        text: `Error performing search: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]
    }
  }
}
