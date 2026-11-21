// Fast broken-CSV reader: run(input) returns exactly csv-reader 1.0.0's
// {columns, rows, errors} for {text, header}, but much faster.
//
// Strategy: most records are plain lines (no quote, no stray CR), so each
// record first tries a whole-line fast path — one slice plus split(',').
// Anything with a quote or a stray CR falls back to a field-at-a-time
// parser that jumps between delimiters with indexOf and slices fields
// instead of building them character by character. Quoted fields are
// sliced between quotes; doubled quotes and embedded line breaks are
// handled segment by segment, and a lone CR inside quotes becomes LF.
// Field results travel in scratch variables, not fresh objects, so the
// hot path allocates almost nothing per field.
//
// Semantics (from the spec):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (stray_cr).
// - A field opening with a quote runs to the next non-doubled quote; ""
//   inside is one quote; CRLF or a lone CR inside reads as LF. Text after
//   the closing quote up to the next comma or line break is appended as
//   it stands (quote_junk when the field ends). A quote that never closes
//   is a literal character and the text after it is re-read as unquoted
//   (unterminated_quote). A quote inside an unquoted field is literal.
// - Fields stay strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows are
//   the records after it, each padded with "" (short_row, with fields:
//   its field count) or cut (long_row, with extra: the cut fields) to
//   the first record's width.
// - Each error is {code, line, row} in the order met; line is the
//   1-based line its record starts on (counting every LF, CRLF and lone
//   CR inside quotes), row is the record's index in rows, null for the
//   header. A field's quote_junk is recorded when the field ends, a
//   record's short_row/long_row when the record ends.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // Record state, set fresh for each record.
  let recordLine = 1;
  let recordRow = null;

  // Scratch results of the last field read: its value, how it ended,
  // and (for unquoted reads) how many characters the call itself kept.
  let fVal = '';
  let fEnd = END;
  let fAdd = 0;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Read an unquoted field starting at pos, with `prefix` already in the
  // field ('' normally; '"' after an unterminated quote; the quoted value
  // for junk after a closing quote). Sets fVal/fEnd/fAdd; fAdd counts
  // only the characters this call kept.
  function readUnquoted(prefix) {
    let v = prefix;
    let p = null; // parts, only when the field is built from >1 segment
    let added = 0;
    while (pos < n) {
      let comma = text.indexOf(',', pos);
      if (comma === -1) comma = n;
      let lf = text.indexOf('\n', pos);
      if (lf === -1) lf = n;
      const end = comma < lf ? comma : lf;
      if (end > pos) {
        const seg = text.slice(pos, end);
        if (seg.indexOf('\r') === -1) {
          if (p !== null) p.push(seg);
          else if (v.length === 0) v = seg;
          else { p = [v, seg]; v = ''; }
          added += seg.length;
          pos = end;
        } else {
          // A CR at the very end of the stretch, right before the LF
          // that ends it, is the CRLF ending the record, not a stray CR.
          const crlf = end === lf && end < n && seg.charCodeAt(seg.length - 1) === 13;
          const body = crlf ? seg.slice(0, -1) : seg;
          // Stray CR(s) inside the body: keep the text around each, drop
          // the CR, record it.
          let at = 0;
          while (true) {
            const c = body.indexOf('\r', at);
            if (c === -1) {
              if (at < body.length) {
                const tail = body.slice(at);
                if (p !== null) p.push(tail);
                else if (v.length === 0) v = tail;
                else { p = [v, tail]; v = ''; }
                added += tail.length;
              }
              break;
            }
            if (c > at) {
              const chunk = body.slice(at, c);
              if (p !== null) p.push(chunk);
              else if (v.length === 0) v = chunk;
              else { p = [v, chunk]; v = ''; }
              added += chunk.length;
            }
            pushError('stray_cr');
            at = c + 1;
          }
          if (crlf) {
            pos = end + 1;
            line += 1;
            fVal = p !== null ? p.join('') : v;
            fEnd = LINE_BREAK;
            fAdd = added;
            return;
          }
          pos = end;
        }
      }
      if (pos >= n) {
        fVal = p !== null ? p.join('') : v;
        fEnd = END;
        fAdd = added;
        return;
      }
      if (text.charCodeAt(pos) === 44) {
        pos += 1;
        fVal = p !== null ? p.join('') : v;
        fEnd = COMMA;
        fAdd = added;
        return;
      }
      // A line break ends the field and the record.
      pos += 1;
      line += 1;
      fVal = p !== null ? p.join('') : v;
      fEnd = LINE_BREAK;
      fAdd = added;
      return;
    }
    fVal = p !== null ? p.join('') : v;
    fEnd = END;
    fAdd = added;
  }

  // Read a quoted field whose opening quote is at pos. Sets fVal/fEnd
  // (fAdd is left as the junk read's count when there is junk).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let qline = line;
    let v = '';
    let p = null;
    let cur = pos;
    while (true) {
      const q = text.indexOf('"', cur);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        pushError('unterminated_quote');
        readUnquoted('"');
        return;
      }
      if (q > cur) {
        const seg = text.slice(cur, q);
        if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
          if (p !== null) p.push(seg);
          else if (v.length === 0) v = seg;
          else { p = [v, seg]; v = ''; }
        } else {
          // Line breaks inside quotes: CRLF and a lone CR each read as
          // one LF, and each counts as a line.
          let out = '';
          let start = 0;
          for (let i = 0; i < seg.length; i++) {
            const ch = seg.charCodeAt(i);
            if (ch === 13) {
              qline += 1;
              out += seg.slice(start, i) + '\n';
              if (seg.charCodeAt(i + 1) === 10) i += 1;
              start = i + 1;
            } else if (ch === 10) {
              qline += 1;
              out += seg.slice(start, i) + '\n';
              start = i + 1;
            }
          }
          out += seg.slice(start);
          if (p !== null) p.push(out);
          else if (v.length === 0) v = out;
          else { p = [v, out]; v = ''; }
        }
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote inside the field.
        if (p !== null) p.push('"');
        else if (v.length === 0) v = '"';
        else { p = [v, '"']; v = ''; }
        cur = q + 2;
        continue;
      }
      // Closing quote found.
      pos = q + 1;
      line = qline;
      const val = p !== null ? p.join('') : v;
      if (pos >= n) {
        fVal = val;
        fEnd = END;
        return;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fVal = val;
        fEnd = COMMA;
        return;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fVal = val;
        fEnd = LINE_BREAK;
        return;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fVal = val;
        fEnd = LINE_BREAK;
        return;
      }
      // What follows the closing quote is appended as it stands, up to
      // the next comma or line break.
      readUnquoted(val);
      if (fAdd > 0) pushError('quote_junk');
      return;
    }
  }

  // Finish one record: drop it when it held only stray CRs, else store it
  // (or the header) at the first record's width.
  function finishRecord(fields, lastQuoted) {
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record ends at the next LF and its first line holds
    // no quote and no stray CR, so it is one slice split on commas.
    // The quote/CR checks run on the line slice, so they never scan past
    // the end of the line.
    const lf = text.indexOf('\n', pos);
    if (lf !== -1) {
      const lineEnd = lf > pos && text.charCodeAt(lf - 1) === 13 ? lf - 1 : lf;
      const lineText = text.slice(pos, lineEnd);
      if (lineText.indexOf('"') === -1 && lineText.indexOf('\r') === -1) {
        pos = lf + 1;
        line += 1;
        finishRecord(lineText.split(','), false);
        continue;
      }
    }

    // Slow path: parse the record field by field.
    const fields = [];
    let lastQuoted = false;
    do {
      lastQuoted = text.charCodeAt(pos) === 34;
      if (lastQuoted) readQuoted();
      else readUnquoted('');
      fields.push(fVal);
    } while (fEnd === COMMA);
    finishRecord(fields, lastQuoted);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
