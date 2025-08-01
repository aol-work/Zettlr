import type { ToolSchema, ToolHandler } from './types'
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
  },
  outputSchema: {
    type: 'object',
    properties: {
      totalTags: {
        type: 'number',
        description: 'Total number of unique tags in the workspace'
      },
      tags: {
        type: 'array',
        description: 'Array of tag information',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Tag name'
            },
            count: {
              type: 'number',
              description: 'Number of files containing this tag'
            },
            files: {
              type: 'array',
              description: 'Array of files containing this tag',
              items: {
                type: 'object',
                properties: {
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
                  }
                },
                required: ['path', 'name']
              }
            },
            color: {
              type: 'string',
              description: 'Tag color (if available)'
            },
            description: {
              type: 'string',
              description: 'Tag description (if available)'
            }
          },
          required: ['name', 'count', 'files']
        }
      }
    },
    required: ['totalTags', 'tags']
  }
}

export const zettlrListTagsHandler: ToolHandler = async (args, context) => {
  const maxResults = typeof args.maxResults === 'number' ? Math.min(Math.max(args.maxResults, 1), 1000) : 100
  const sortBy = (args.sortBy as string) || 'count'

  try {
    // Get the tag database from workspaces
    const tagDatabase = context.workspaces.getTags()

    if (tagDatabase.size === 0) {
      const result = {
        totalTags: 0,
        tags: []
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }],
        isError: false
      }
    }

    // Convert Map to array and count occurrences
    const tagCounts = new Map<string, number>()
    const tagFiles = new Map<string, Set<string>>()

    for (const [ filePath, tags ] of tagDatabase) {
      for (const tag of tags) {
        const normalizedTag = tag.toLowerCase()
        tagCounts.set(normalizedTag, (tagCounts.get(normalizedTag) ?? 0) + 1)
        
        if (!tagFiles.has(normalizedTag)) {
          tagFiles.set(normalizedTag, new Set())
        }
        tagFiles.get(normalizedTag)?.add(filePath)
      }
    }

    // Convert to array format
    const tagArray = Array.from(tagCounts.entries()).map(([ tag, count ]) => {
      const files = Array.from(tagFiles.get(tag) ?? [])
      
      // Get file objects with additional information
      const allFiles = context.workspaces.getAllFiles()
      const fileObjects = files.map(filePath => {
        const file = allFiles.find(f => f.path === filePath)
        const fileName = file?.name ?? filePath.split('/').pop() ?? ''
        const fileId = getFileId(filePath, context)

        return {
          path: filePath,
          name: fileName,
          id: fileId !== '' ? fileId : undefined
        }
      })

      return {
        name: tag,
        count: count,
        files: fileObjects,
        // TODO: Add color and description when we have access to colored tag info
        color: undefined,
        description: undefined
      }
    })

    // Sort the results
    if (sortBy === 'name' || sortBy === 'alphabetical') {
      tagArray.sort((a, b) => a.name.localeCompare(b.name))
    } else {
      // Default: sort by count (descending)
      tagArray.sort((a, b) => b.count - a.count)
    }

    // Limit results
    const limitedTags = tagArray.slice(0, maxResults)

    const result = {
      totalTags: tagArray.length,
      tags: limitedTags
    }

    return {
      // Backwards compatibility: unstructured content
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }],
      // MCP 2025-06-18: Structured content for better client integration
      structuredContent: result,
      isError: false
    }
  } catch (error) {
    context.logger.error('[MCP] Error listing tags:', error)
    return {
      content: [{
        type: 'text',
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }],
      isError: true
    }
  }
}
