import type { ToolSchema, ToolHandler } from './types'
import { getFileId } from './common'
import type { MDFileDescriptor } from '@dts/common/fsal'

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
    required: [ ]
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
                required: [ 'path', 'name' ]
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
          required: [ 'name', 'count', 'files' ]
        }
      }
    },
    required: [ 'totalTags', 'tags' ]
  }
}

export const zettlrListTagsHandler: ToolHandler = async (args, context) => {
  const maxResultsArg: unknown = args.maxResults
  const maxResults = typeof maxResultsArg === 'number'
    ? Math.min(Math.max(maxResultsArg, 1), 1000)
    : 100
  const sortBy = (args.sortBy as string) || 'count'

  try {
    const allFiles = (await context.fsal.getAllLoadedDescriptors())
      .filter((d): d is MDFileDescriptor => d.type === 'file')
    const fileByPath = new Map<string, MDFileDescriptor>()
    for (const f of allFiles) {
      fileByPath.set(f.path, f)
    }

    if (allFiles.length === 0) {
      const result = { totalTags: 0, tags: [ ] }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false
      }
    }

    const tagCounts = new Map<string, number>()
    const tagFiles = new Map<string, Set<string>>()

    for (const file of allFiles) {
      const fileTags: string[] = []
      // Inline tags extracted by Zettlr parser
      fileTags.push(...file.tags)
      // YAML frontmatter tags/keywords (if available)
      if (file.frontmatter != null) {
        if (Array.isArray(file.frontmatter.tags)) {
          for (const t of file.frontmatter.tags as unknown[]) {
            fileTags.push(String(t))
          }
        }
        if (Array.isArray(file.frontmatter.keywords)) {
          for (const k of file.frontmatter.keywords as unknown[]) {
            fileTags.push(String(k))
          }
        }
      }

      const uniqueNormalized = new Set(
        fileTags
          .map(t => String(t).trim())
          .filter(t => t !== '')
          .map(t => t.toLowerCase())
      )

      for (const normalizedTag of uniqueNormalized) {
        tagCounts.set(normalizedTag, (tagCounts.get(normalizedTag) ?? 0) + 1)
        if (!tagFiles.has(normalizedTag)) {
          tagFiles.set(normalizedTag, new Set())
        }
        tagFiles.get(normalizedTag)?.add(file.path)
      }
    }

    const tagArray = Array.from(tagCounts.entries()).map(([ tag, count ]) => {
      const files = Array.from(tagFiles.get(tag) ?? [])
      
      const fileObjects = files.map(filePath => {
        const file = fileByPath.get(filePath)
        const fileName = file?.name ?? filePath.split('/').pop() ?? ''
        const fileId = getFileId(file)

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
        color: undefined,
        description: undefined
      }
    })

    if (sortBy === 'name' || sortBy === 'alphabetical') {
      tagArray.sort((a, b) => a.name.localeCompare(b.name))
    } else {
      tagArray.sort((a, b) => b.count - a.count)
    }
    const limitedTags = tagArray.slice(0, maxResults)

    const result = {
      totalTags: tagArray.length,
      tags: limitedTags
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
