// Parseur minimal de multipart/form-data (sans dependance externe) : suffisant pour un formulaire
// avec des champs texte et un fichier unique (import CSV). Ne gere pas le multipart imbrique.

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]).trim() : null;
  if (!boundary) throw new Error('En-tete multipart invalide (boundary manquant)');

  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};

  let pos = buffer.indexOf(delimiter);
  if (pos === -1) return { fields, files };
  pos += delimiter.length;

  while (pos < buffer.length) {
    if (buffer[pos] === 0x2d && buffer[pos + 1] === 0x2d) break; // "--" => boundary de fin
    pos += 2; // saute le CRLF apres le delimiteur

    const nextDelim = buffer.indexOf(delimiter, pos);
    if (nextDelim === -1) break;
    const partEnd = nextDelim - 2; // enleve le CRLF final avant le prochain delimiteur
    const part = buffer.slice(pos, Math.max(pos, partEnd));

    const headerSep = part.indexOf('\r\n\r\n');
    if (headerSep !== -1) {
      const headerText = part.slice(0, headerSep).toString('utf8');
      const body = part.slice(headerSep + 4);
      const nameMatch = /name="([^"]*)"/i.exec(headerText);
      const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
      const name = nameMatch ? nameMatch[1] : null;
      if (name) {
        if (filenameMatch) {
          files[name] = { filename: filenameMatch[1], content: body };
        } else {
          fields[name] = body.toString('utf8');
        }
      }
    }

    pos = nextDelim + delimiter.length;
  }

  return { fields, files };
}

module.exports = { parseMultipart };
