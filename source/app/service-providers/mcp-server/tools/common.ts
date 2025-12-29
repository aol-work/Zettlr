import type { MDFileDescriptor } from '@dts/common/fsal'

/**
 * Gets the Zettlr internal ID for a descriptor if available.
 */
export function getFileId (descriptor: { id?: string } | undefined): string {
  if (descriptor?.id === undefined) {
    return ''
  }
  return typeof descriptor.id === 'string' ? descriptor.id : String(descriptor.id)
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
