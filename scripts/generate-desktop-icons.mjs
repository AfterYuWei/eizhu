import { app, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Render the same vector at every size using the installed Electron, without
// downloading an image converter or resampling the generated concept artwork.
const root = fileURLToPath(new URL('../', import.meta.url))
const resources = join(root, 'apps/desktop/resources')

app.setPath('userData', mkdtempSync(join(tmpdir(), 'eizhu-icon-generation-')))
app.whenReady().then(async () => {
  try {
    app.dock?.hide()
    const logo = await readFile(join(root, 'apps/web/public/eizhu-logo.svg'), 'utf8')
    const mark = logo.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)?.[1].trim()
    if (!mark) throw new Error('品牌 SVG 缺少图形')
    const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="eizhu">
  <rect x="64" y="64" width="896" height="896" rx="192" fill="#fafafa"/>
  <g transform="translate(104 104) scale(12.75)" color="#171717">
    ${mark}
  </g>
</svg>
`
    const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="eizhu">
  <style>
    svg { color: #000; }
    @media (prefers-color-scheme: dark) { svg { color: #fff; } }
  </style>
  ${mark}
</svg>
`
    const window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
    })
    await window.loadURL(
      'data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">',
    )
    const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
    const rendered = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    image.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`)};
    await image.decode();
    return ${JSON.stringify(sizes)}.map(size => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return [size, canvas.toDataURL('image/png').split(',')[1]];
    });
  })()`)
    const pngs = new Map(rendered.map(([size, png]) => [size, Buffer.from(png, 'base64')]))
    await writeFile(join(resources, 'icon.svg'), icon)
    await writeFile(join(root, 'apps/web/public/favicon.svg'), favicon)
    for (const size of [128, 256]) await writeFile(join(resources, `${size}x${size}.png`), pngs.get(size))
    await writeFile(join(resources, 'brand.png'), pngs.get(1024))

    // ICO directory entries point to lossless PNG images (Windows Vista and later).
    const icoSizes = sizes.filter((size) => size <= 256)
    const icoHeader = Buffer.alloc(6 + icoSizes.length * 16)
    icoHeader.writeUInt16LE(1, 2)
    icoHeader.writeUInt16LE(icoSizes.length, 4)
    let offset = icoHeader.length
    for (const [index, size] of icoSizes.entries()) {
      const entry = 6 + index * 16
      const png = pngs.get(size)
      icoHeader[entry] = icoHeader[entry + 1] = size === 256 ? 0 : size
      icoHeader.writeUInt16LE(1, entry + 4)
      icoHeader.writeUInt16LE(32, entry + 6)
      icoHeader.writeUInt32LE(png.length, entry + 8)
      icoHeader.writeUInt32LE(offset, entry + 12)
      offset += png.length
    }
    await writeFile(
      join(resources, 'icon.ico'),
      Buffer.concat([icoHeader, ...icoSizes.map((size) => pngs.get(size))]),
    )

    // Modern ICNS chunks contain PNGs, including the standard Retina variants.
    const icnsTypes = [
      ['icp4', 16],
      ['icp5', 32],
      ['icp6', 64],
      ['ic07', 128],
      ['ic08', 256],
      ['ic09', 512],
      ['ic10', 1024],
      ['ic11', 32],
      ['ic12', 64],
      ['ic13', 256],
      ['ic14', 512],
    ]
    const chunks = icnsTypes.map(([type, size]) => {
      const png = pngs.get(size)
      const header = Buffer.alloc(8)
      header.write(type)
      header.writeUInt32BE(png.length + 8, 4)
      return Buffer.concat([header, png])
    })
    const icnsHeader = Buffer.alloc(8)
    icnsHeader.write('icns')
    icnsHeader.writeUInt32BE(8 + chunks.reduce((length, chunk) => length + chunk.length, 0), 4)
    await writeFile(join(resources, 'icon.icns'), Buffer.concat([icnsHeader, ...chunks]))
    console.log('已生成品牌 SVG、favicon、128/256/1024 PNG、Windows ICO 和 macOS ICNS')
    window.destroy()
    app.quit()
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
