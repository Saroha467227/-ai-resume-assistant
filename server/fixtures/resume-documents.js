import { crc32 } from 'node:zlib';

export const resumeLines = [
  'Alex Morgan',
  'Skills: JavaScript, Node.js, Express, Mongo',
  'Experience',
  'Backend developer | Jan 2022 - Jan 2025',
  'Projects',
  'Built a Node.js inventory API with automated tests.',
  'Education',
  'Bachelor of Computer Science'
];

export function pdfWithText(lines) {
  const escaped = lines.map((line) => line.replace(/[\\()]/g, '\\$&'));
  const stream = 'BT /F1 12 Tf 50 750 Td 16 TL\n'
    + escaped.map((line) => '(' + line + ') Tj T*').join('\n') + '\nET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream'
  ];
  let data = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(data);
    data += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    return offset;
  });
  const start = Buffer.byteLength(data);
  data += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  data += offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  data += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n';
  return Buffer.from(data);
}

export function docxWithText(lines) {
  const types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>';
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + lines.map((line) => '<w:p><w:r><w:t>' + line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') + '</w:t></w:r></w:p>').join('')
    + '</w:body></w:document>';
  const files = [['[Content_Types].xml', types], ['word/document.xml', xml]];
  const entries = [];
  const directory = [];
  let offset = 0;
  for (const [entryName, text] of files) {
    const name = Buffer.from(entryName);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 28);
    central.writeUInt32LE(offset, 42);
    entries.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, central, end]);
}
