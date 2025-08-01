import { getZettlrVersionSchema, getZettlrVersionHandler } from './get-zettlr-version'
import { zettlrSearchTitleSchema, zettlrSearchTitleHandler } from './zettlr-search-title'
import { zettlrSearchKeywordSchema, zettlrSearchKeywordHandler } from './zettlr-search-keyword'
import { zettlrSearchTagSchema, zettlrSearchTagHandler } from './zettlr-search-tag'
import { zettlrListTagsSchema, zettlrListTagsHandler } from './zettlr-list-tags'
import { zettlrReadFileSchema, zettlrReadFileHandler } from './zettlr-read-file'

export type { ToolSchema, ToolHandler, ToolResult, ToolContext } from './types'
export { getFileId, getFileDisplayTitle } from './common'
export {
  getZettlrVersionSchema, getZettlrVersionHandler,
  zettlrSearchTitleSchema, zettlrSearchTitleHandler,
  zettlrSearchKeywordSchema, zettlrSearchKeywordHandler,
  zettlrSearchTagSchema, zettlrSearchTagHandler,
  zettlrListTagsSchema, zettlrListTagsHandler,
  zettlrReadFileSchema, zettlrReadFileHandler
}

export const allToolSchemas = [
  getZettlrVersionSchema,
  zettlrSearchTitleSchema,
  zettlrSearchKeywordSchema,
  zettlrSearchTagSchema,
  zettlrListTagsSchema,
  zettlrReadFileSchema
]

export const toolHandlers = {
  'get-zettlr-version': getZettlrVersionHandler,
  'zettlr_search_title': zettlrSearchTitleHandler,
  'zettlr_search_keyword': zettlrSearchKeywordHandler,
  'zettlr_search_tag': zettlrSearchTagHandler,
  'zettlr_list_tags': zettlrListTagsHandler,
  'zettlr_read_file': zettlrReadFileHandler
}
