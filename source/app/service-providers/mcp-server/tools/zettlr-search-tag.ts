import type { ToolSchema, ToolHandler, ToolContext } from './types'
import type { MDFileDescriptor } from '@dts/common/fsal'
import { getFileId } from './common'

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

export const zettlrSearchTagSchema: ToolSchema = {
  name: 'zettlr_search_tag',
  description: 'Search for files containing a specific tag. Tags can be inline #hashtags or defined in YAML frontmatter (tags/keywords fields). Case-insensitive matching.',
  inputSchema: {
    type: 'object',
    properties: {
      tag: {
        type: 'string',
        description: 'The tag to search for (without the # prefix). Example: "todo", "project", "meeting". Case-insensitive.'
      },
      sortBy: {
        type: 'string',
        description: 'How to sort the results',
        enum: [ 'relevance', 'name', 'modified', 'created' ],
        default: 'relevance'
      },
      maxResults: {
        type: 'integer',
        description: 'Maximum number of files to return (default: 50)',
        default: 50,
        minimum: 1,
        maximum: 1000
      }
    },
    required: ['tag']
  }
}

export const zettlrSearchTagHandler: ToolHandler = async (args: { tag: string, sortBy?: string, maxResults?: number }, context: ToolContext) => {
  const searchTag = args.tag as string
  const sortBy = args.sortBy ?? 'relevance'
  const maxResults = typeof args.maxResults === 'number' ? Math.min(Math.max(args.maxResults, 1), 1000) : 50

  if (typeof searchTag !== 'string' || searchTag.trim() === '') {
    return {
      content: [{
        type: 'text',
        text: 'Error: Tag must be a non-empty string'
      }]
    }
  }

  try {
    // Get the tag database from workspaces
    const tagDatabase = context.workspaces.getTags()

    // Clean the search tag (remove # if present, convert to lowercase for case-insensitive search)
    const cleanSearchTag = searchTag.replace(/^#+/, '').toLowerCase().trim()

    if (cleanSearchTag === '') {
      return {
        content: [{
          type: 'text',
          text: 'Error: Tag cannot be empty after removing # prefix'
        }]
      }
    }

    // Find matching files
    const matchingFiles: string[] = []

    for (const [ filePath, tags ] of tagDatabase) {
      // Check if any tag matches (case-insensitive)
      const hasMatchingTag = tags.some(tag =>
        tag.toLowerCase() === cleanSearchTag
      )

      if (hasMatchingTag) {
        matchingFiles.push(filePath)
      }
    }

    if (matchingFiles.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No files found with tag "${cleanSearchTag}"`
        }]
      }
    }

    // Get file descriptors for the matching files
    const allFiles = context.workspaces.getAllFiles()
    const matchingFileDescriptors = allFiles
      .filter(file => file.type === 'file' && matchingFiles.includes(file.path))
      .map(file => file as MDFileDescriptor)

    // Sort the results
    let sortedFiles = [...matchingFileDescriptors]

    switch (sortBy) {
      case 'name':
        sortedFiles.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'modified':
        sortedFiles.sort((a, b) => b.modtime - a.modtime)
        break
      case 'created':
        sortedFiles.sort((a, b) => b.creationtime - a.creationtime)
        break
      case 'relevance':
      default:
        // For relevance, we could sort by multiple factors
        // For now, let's sort by modification time as a proxy for relevance
        sortedFiles.sort((a, b) => b.modtime - a.modtime)
        break
    }

    // Limit results
    const limitedFiles = sortedFiles.slice(0, maxResults)

    // Format the results
    let resultText = `Found ${matchingFiles.length} file(s) with tag "#${cleanSearchTag}"`

    if (matchingFiles.length > maxResults) {
      resultText += ` (showing first ${maxResults})`
    }

    resultText += ':\n\n'

    for (const file of limitedFiles) {
      const fileTitle = getFileDisplayTitle(file)
      const modifiedDate = new Date(file.modtime).toLocaleDateString()
      const fileId = getFileId(file.path, context)

      resultText += `📄 **${fileTitle}** (${file.name})\n`
      resultText += `   Path: ${file.path}\n`
      if (fileId) {
        resultText += `   ID: ${fileId}\n`
      }
      resultText += `   Modified: ${modifiedDate}\n`

      // Show all tags for this file to provide context
      const fileTags = tagDatabase.get(file.path) ?? []
      if (fileTags.length > 0) {
        const tagList = fileTags.map(tag => `#${tag}`).join(', ')
        resultText += `   Tags: ${tagList}\n`
      }

      // Add file size if available
      if (file.size > 0) {
        const sizeKB = Math.round(file.size / 1024 * 10) / 10
        resultText += `   Size: ${sizeKB} KB\n`
      }

      resultText += '\n'
    }

    if (matchingFiles.length > maxResults) {
      const remaining = matchingFiles.length - maxResults
      resultText += `\n... and ${remaining} more file(s) with tag "#${cleanSearchTag}" (use maxResults parameter to see more)`
    }

    return {
      content: [{
        type: 'text',
        text: resultText
      }]
    }
  } catch (error) {
    context.logger.error('[MCP] Error in tag search:', error)
    return {
      content: [{
        type: 'text',
        text: `Error performing tag search: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]
    }
  }
}
