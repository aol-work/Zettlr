import type { ToolContext } from './types'
import type { MDFileDescriptor } from '@dts/common/fsal'

/**
 * Gets the Zettlr internal ID for a file path if available
 *
 * @param   {string}      filePath  The file path
 * @param   {ToolContext} context   The tool context
 *
 * @return  {string}                The ID if found, empty string otherwise
 */
export function getFileId (filePath: string, context: ToolContext): string {
  const idMap = context.workspaces.getIds()
  return idMap.get(filePath) ?? ''
}

/**
 * Gets the display title for a file, preferring YAML title, then H1 heading, then filename
 *
 * @param   {MDFileDescriptor}  file  The file descriptor
 *
 * @return  {string}                  The display title
 */
export function getFileDisplayTitle (file: MDFileDescriptor): string {
  if (file.frontmatter != null && 'title' in file.frontmatter && typeof file.frontmatter.title === 'string') {
    return file.frontmatter.title
  }

  if (file.yamlTitle !== undefined) {
    return file.yamlTitle
  }

  if (file.firstHeading != null && file.firstHeading.trim() !== '') {
    return file.firstHeading
  }
  return file.name.replace(/\.[^/.]+$/, '')
}
