import JSZip from 'jszip'

export type TableCell = string | number
export interface ExportTable {
  headers: string[]
  rows: TableCell[][]
  widths: number[]
}

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function xml(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const point = character.codePointAt(0)!
      return (
        point === 9 ||
        point === 10 ||
        point === 13 ||
        (point >= 0x20 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) ||
        point >= 0x10000
      )
    })
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function column(index: number): string {
  let result = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result
  }
  return result
}

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRels = 'http://schemas.openxmlformats.org/package/2006/relationships'
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** A single, filterable worksheet. Text is always literal; quantities remain numeric cells. */
export async function tableToXlsx(
  table: ExportTable,
  sheetName: string
): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip()
  const name =
    sheetName
      .replace(/[[\]:*?/\\]/g, ' ')
      .replace(/^'+|'+$/g, '')
      .trim()
      .slice(0, 31) || 'Sheet1'
  const range = `A1:${column(table.headers.length - 1)}${table.rows.length + 1}`
  const rows = [table.headers, ...table.rows]
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => {
          const ref = `${column(colIndex)}${rowIndex + 1}`
          if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw new Error('Invalid spreadsheet quantity')
            return `<c r="${ref}" s="2"><v>${value}</v></c>`
          }
          return `<c r="${ref}" s="${rowIndex === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')
  zip.file(
    '[Content_Types].xml',
    `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
  )
  zip.file(
    '_rels/.rels',
    `${declaration}<Relationships xmlns="${packageRels}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  )
  zip.file(
    'xl/workbook.xml',
    `${declaration}<workbook xmlns="${main}" xmlns:r="${office}"><sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `${declaration}<Relationships xmlns="${packageRels}"><Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${office}/styles" Target="styles.xml"/></Relationships>`
  )
  zip.file(
    'xl/styles.xml',
    `${declaration}<styleSheet xmlns="${main}"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.##"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE0F2FE"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    `${declaration}<worksheet xmlns="${main}"><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${table.widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData><autoFilter ref="${range}"/></worksheet>`
  )
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return new Uint8Array(bytes)
}

/** Excel-friendly UTF-8 CSV. Escape formula-like text without changing numeric quantities. */
export function tableToCsv(table: ExportTable, language: string): string {
  const number = new Intl.NumberFormat(language, { useGrouping: false, maximumFractionDigits: 2 })
  const field = (cell: TableCell) => {
    let value = typeof cell === 'number' ? number.format(cell) : cell
    if (typeof cell === 'string' && /^[\s]*[=+\-@]/.test(value)) value = `'${value}`
    return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  }
  return (
    '\ufeff' +
    [table.headers, ...table.rows].map((row) => row.map(field).join(';')).join('\r\n') +
    '\r\n'
  )
}
