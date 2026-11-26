import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import mammoth from 'mammoth';
import yauzl from 'yauzl';
import { HttpError } from './http.js';

const openZip = promisify(yauzl.fromBuffer);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GENERIC_MIME = ['', 'application/octet-stream'];

async function validateDocx(buffer) {
  const zip = await openZip(buffer, { lazyEntries: true });
  await new Promise((resolve, reject) => {
    const files = new Set();
    let bytes = 0;

    zip.on('error', reject);
    zip.on('entry', (entry) => {
      files.add(entry.fileName);
      bytes += entry.uncompressedSize;
      if (files.size > 300 || bytes > 25 * 1024 * 1024 || (entry.generalPurposeBitFlag & 1)) {
        zip.close();
        reject(new Error('Unsupported document archive'));
        return;
      }
      zip.readEntry();
    });
    zip.on('end', () => {
      zip.close();
      if (files.has('[Content_Types].xml') && files.has('word/document.xml')) resolve();
      else reject(new Error('Missing Word document'));
    });
    zip.readEntry();
  });
}

export async function parseResume(file) {
  if (!file) throw new HttpError(400, 'Choose a PDF or DOCX resume.');
  const fileName = basename(file.originalname.replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const extension = fileName.toLowerCase().split('.').pop();
  const isPdf = extension === 'pdf' && [ ...GENERIC_MIME, 'application/pdf' ].includes(file.mimetype)
    && file.buffer.subarray(0, 5).toString() === '%PDF-';
  const isDocx = extension === 'docx' && [ ...GENERIC_MIME, DOCX ].includes(file.mimetype)
    && file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (!isPdf && !isDocx) throw new HttpError(415, 'Choose a valid PDF or DOCX file.');

  let text;
  try {
    if (isPdf) {
      const { CanvasFactory, getPath } = await import('pdf-parse/worker');
      const { PDFParse } = await import('pdf-parse');
      PDFParse.setWorker(pathToFileURL(getPath()).href);
      const parser = new PDFParse({
        data: Uint8Array.from(file.buffer),
        CanvasFactory,
        isEvalSupported: false,
        disableFontFace: true
      });
      try {
        const info = await parser.getInfo();
        if (info.total > 30) throw new HttpError(422, 'Use a resume with 30 pages or fewer.');
        text = (await parser.getText()).text.replace(/^-- \d+ of \d+ --$/gm, '');
      } finally {
        await parser.destroy();
      }
    } else {
      await validateDocx(file.buffer);
      text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (isPdf && (error.code === 'ERR_MODULE_NOT_FOUND' || /fake worker|native binding|DOMMatrix/.test(error.message))) {
      console.error('PDF runtime initialization failed:', error.name, error.code || '');
      throw new HttpError(503, 'PDF processing is temporarily unavailable. Try again or upload a DOCX file.');
    }
    throw new HttpError(422, 'This file could not be read. Try exporting a fresh copy of your resume.');
  }

  const rawText = text.normalize('NFKC').replaceAll('\0', '').replace(/\r\n?/g, '\n').trim();
  if (rawText.length < 20) {
    throw new HttpError(422, isPdf
      ? 'This PDF has no usable text layer. Upload a text-based PDF or DOCX.'
      : 'The document does not contain enough readable text.');
  }
  return {
    fileName: fileName.slice(0, 180),
    mimeType: isPdf ? 'application/pdf' : DOCX,
    rawText: rawText.slice(0, 80_000)
  };
}
