jest.mock('megajs', () => ({
    File: {
        fromURL: jest.fn()
    }
}));

import { File } from 'megajs';
import { openMegaFileStream } from './index.mjs';

describe('openMegaFileStream', () => {
    const stream = { on: jest.fn() };
    const file = {
        size: 1024,
        loadAttributes: jest.fn(),
        download: jest.fn(() => stream)
    };

    beforeEach(() => {
        jest.clearAllMocks();
        file.size = 1024;
        file.loadAttributes.mockResolvedValue(file);
        file.download.mockReturnValue(stream);
        File.fromURL.mockReturnValue(file);
    });

    it('opens the full MEGA video stream', async () => {
        await expect(openMegaFileStream('https://mega.nz/file/id#key')).resolves.toEqual({
            stream,
            statusCode: 200,
            headers: {
                'Accept-Ranges': 'bytes',
                'Content-Type': 'video/mp4',
                'Content-Length': '1024',
                'Cache-Control': 'private, max-age=300'
            }
        });
        expect(File.fromURL).toHaveBeenCalledWith('https://mega.nz/file/id#key');
        expect(file.download).toHaveBeenCalledWith({
            start: 0,
            end: 1023,
            maxConnections: 2,
            forceHttps: true
        });
    });

    it('supports byte-range requests for video playback controls', async () => {
        await expect(openMegaFileStream('https://mega.nz/file/id#key', 'bytes=100-199'))
            .resolves.toEqual({
                stream,
                statusCode: 206,
                headers: {
                    'Accept-Ranges': 'bytes',
                    'Content-Type': 'video/mp4',
                    'Content-Length': '100',
                    'Content-Range': 'bytes 100-199/1024',
                    'Cache-Control': 'private, max-age=300'
                }
            });
        expect(file.download).toHaveBeenCalledWith({
            start: 100,
            end: 199,
            maxConnections: 2,
            forceHttps: true
        });
    });

    it('supports suffix byte-range requests', async () => {
        const result = await openMegaFileStream('https://mega.nz/file/id#key', 'bytes=-128');
        expect(result.headers['Content-Range']).toBe('bytes 896-1023/1024');
        expect(file.download).toHaveBeenCalledWith(expect.objectContaining({ start: 896, end: 1023 }));
    });

    it('rejects unsatisfiable byte ranges', async () => {
        await expect(openMegaFileStream('https://mega.nz/file/id#key', 'bytes=2048-'))
            .rejects.toMatchObject({ statusCode: 416, contentRange: 'bytes */1024' });
        expect(file.download).not.toHaveBeenCalled();
    });

    it('sets the content type for a thumbnail response', async () => {
        const result = await openMegaFileStream('https://mega.nz/file/id#key', undefined, 'image/jpeg');

        expect(result.headers['Content-Type']).toBe('image/jpeg');
    });
});
