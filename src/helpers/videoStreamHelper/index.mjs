import { File } from 'megajs';

export async function openMegaFileStream(megaLink, rangeHeader, contentType = 'video/mp4') {
    const file = File.fromURL(megaLink);
    await file.loadAttributes();
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
        throw new Error('MEGA returned an invalid video size.');
    }

    const range = parseByteRange(rangeHeader, file.size);
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(file.size - 1, 0);
    const headers = {
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Content-Length': String(file.size === 0 ? 0 : end - start + 1),
        'Cache-Control': 'private, max-age=300'
    };

    if (range) {
        headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
    }

    return {
        // MEGA's single-connection reader can leave an AbortError unhandled when playback switches videos.
        stream: file.download({ start, end, maxConnections: 2, forceHttps: true }),
        statusCode: range ? 206 : 200,
        headers
    };
}

function parseByteRange(header, size) {
    if (!header) return null;

    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!match || size === 0 || (!match[1] && !match[2])) {
        throw createRangeError(size);
    }

    let start;
    let end;
    if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (suffixLength <= 0) throw createRangeError(size);
        start = Math.max(size - suffixLength, 0);
        end = size - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    }

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) {
        throw createRangeError(size);
    }
    return { start, end };
}

function createRangeError(size) {
    const error = new Error('Requested video range is not satisfiable.');
    error.statusCode = 416;
    error.contentRange = `bytes */${size}`;
    return error;
}
