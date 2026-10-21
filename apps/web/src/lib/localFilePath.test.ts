import { expect, it } from 'vitest'
import { localFilePath } from './localFilePath'
it('外部文件路径保留 Windows 驱动器、UNC 共享和 POSIX 绝对路径', () => {
  expect(localFilePath('C:\\Users\\a\\文档.txt')).toBe('/C:/Users/a/文档.txt')
  expect(localFilePath('\\\\server\\share\\a.txt')).toBe('/UNC/server/share/a.txt')
  expect(localFilePath('/home/u/a.txt')).toBe('/home/u/a.txt')
})
