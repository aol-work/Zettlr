import type { ToolSchema, ToolHandler, ToolContext } from './types'
import { getFileId } from './common'

export const zettlrListTagsSchema: ToolSchema = {
  name: 'zettlr_list_tags',
  description: 'Get a list of all tags used across all files in the Zettlr workspace. Shows tag names, file counts, and optional colors/descriptions.',
  inputSchema: {
    type: 'object',
    properties: {
      sortBy: {
        type: 'string',
        description: 'How to sort the tags',
        enum: [ 'count', 'name', 'alphabetical' ],
        default: 'count'
      },
      includeColors: {
        type: 'boolean',
        description: 'Whether to include color and description information for colored tags',
        default: true
      },
      maxResults: {
        type: 'integer',
        description: 'Maximum number of tags to return (default: 100)',
        default: 100,
        minimum: 1,
        maximum: 1000
      }
    },
    required: []
  }
}

export const zettlrListTagsHandler: ToolHandler = async (args: { sortBy?: string, includeColors?: boolean, maxResults?: number }, context: ToolContext) => {
  const sortBy = args.sortBy ?? 'count'
  const includeColors = args.includeColors !== false // Default to true
  const maxResults = typeof args.maxResults === 'number' ? Math.min(Math.max(args.maxResults, 1), 1000) : 100

  try {
    // Get the tag database from workspaces - this returns a Map<string, string[]>
    const tagDatabase = context.workspaces.getTags()

    if (tagDatabase.size === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No tags found in the current workspace. Make sure you have files with tags loaded.'
        }]
      }
    }

    // Build a map of tag -> file count
    const tagCounts = new Map<string, number>()
    const tagFiles = new Map<string, string[]>()

    for (const [ filePath, tags ] of tagDatabase) {
      for (const tag of tags) {
        const currentCount = tagCounts.get(tag) ?? 0
        const currentFiles = tagFiles.get(tag) ?? []

        tagCounts.set(tag, currentCount + 1)
        tagFiles.set(tag, [ ...currentFiles, filePath ])
      }
    }

    // Convert to array for sorting
    const tagList = Array.from(tagCounts.entries()).map(([ name, count ]) => ({
      name,
      count,
      files: tagFiles.get(name) ?? []
    }))

    // Sort the tags
    switch (sortBy) {
      case 'name':
      case 'alphabetical':
        tagList.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
        break
      case 'count':
      default:
        tagList.sort((a, b) => b.count - a.count) // Descending by count
        break
    }

    // Limit results
    const limitedTags = tagList.slice(0, maxResults)

    // Try to get colored tag information if requested
    let coloredTagsInfo: any = null
    if (includeColors) {
      try {
        // We need to access the tag provider through the app service container
        // This is a bit tricky since we don't have direct access to it from the context
        // For now, we'll skip the colored tags info and mention it in the output
        coloredTagsInfo = null
      } catch (error) {
        // Silently ignore errors getting colored tag info
        coloredTagsInfo = null
      }
    }

    // Format the results
    const totalTags = tagList.length
    const totalFiles = tagDatabase.size

    let resultText = `Found ${totalTags} unique tag(s) across ${totalFiles} file(s)`

    if (totalTags > maxResults) {
      resultText += ` (showing first ${maxResults})`
    }

    resultText += ':\n\n'

    for (const tag of limitedTags) {
      resultText += `🏷️  **#${tag.name}** (${tag.count} file${tag.count !== 1 ? 's' : ''})\n`

      // Show a few example files if there aren't too many
      if (tag.count <= 3) {
        for (const filePath of tag.files) {
          const fileName = filePath.split('/').pop() ?? filePath
          const fileId = getFileId(filePath, context)
          const idDisplay = fileId ? ` [ID: ${fileId}]` : ''
          resultText += `   📄 ${fileName}${idDisplay}\n`
        }
      } else {
        // Show first 2 files and indicate there are more
        for (let i = 0; i < Math.min(2, tag.files.length); i++) {
          const fileName = tag.files[i].split('/').pop() ?? tag.files[i]
          const fileId = getFileId(tag.files[i], context)
          const idDisplay = fileId ? ` [ID: ${fileId}]` : ''
          resultText += `   📄 ${fileName}${idDisplay}\n`
        }
        if (tag.files.length > 2) {
          resultText += `   ... and ${tag.files.length - 2} more file(s)\n`
        }
      }

      resultText += '\n'
    }

    if (totalTags > maxResults) {
      const remaining = totalTags - maxResults
      resultText += `\n... and ${remaining} more tag(s) (use maxResults parameter to see more)\n`
    }

    if (includeColors && coloredTagsInfo === null) {
      resultText += '\n💡 Note: Color information for tags is not currently available through this interface.\n'
    }

    return {
      content: [{
        type: 'text',
        text: resultText
      }]
    }
  } catch (error) {
    context.logger.error('[MCP] Error in list tags:', error)
    return {
      content: [{
        type: 'text',
        text: `Error listing tags: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]
    }
  }
}
