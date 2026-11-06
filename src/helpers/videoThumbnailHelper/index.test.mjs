jest.mock('node:child_process', () => ({
    execFile: jest.fn()
}));

jest.mock('node:fs/promises', () => ({
    stat: jest.fn()
}));

import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createVideoThumbnail } from './index.mjs';

describe('createVideoThumbnail', () => {
    const previousRecordingFolder = process.env.APP_RECORDING_FOLDER;
    const previousFfmpegPath = process.env.FFMPEG_PATH;

    beforeEach(() => {
        process.env.APP_RECORDING_FOLDER = '/recordings';
        process.env.FFMPEG_PATH = '/usr/bin/ffmpeg';
        jest.clearAllMocks();
        execFile.mockImplementation((_command, _args, callback) => callback(null, '', ''));
        stat.mockResolvedValue({ size: 1024 });
    });

    afterAll(() => {
        if (previousRecordingFolder === undefined) {
            delete process.env.APP_RECORDING_FOLDER;
        } else {
            process.env.APP_RECORDING_FOLDER = previousRecordingFolder;
        }
        if (previousFfmpegPath === undefined) {
            delete process.env.FFMPEG_PATH;
        } else {
            process.env.FFMPEG_PATH = previousFfmpegPath;
        }
    });

    it('extracts one small JPEG beside the MP4 using the same base filename', async () => {
        await expect(createVideoThumbnail('Front door-2026-11-06_120000.mp4'))
            .resolves.toBe('Front door-2026-11-06_120000.jpg');

        expect(execFile).toHaveBeenCalledWith('/usr/bin/ffmpeg', [
            '-hide_banner',
            '-loglevel', 'error',
            '-ss', '0.5',
            '-i', '/recordings/Front door-2026-11-06_120000.mp4',
            '-frames:v', '1',
            '-vf', 'scale=320:-2',
            '-q:v', '5',
            '-y', '/recordings/Front door-2026-11-06_120000.jpg'
        ], expect.any(Function));
        expect(stat).toHaveBeenCalledWith('/recordings/Front door-2026-11-06_120000.jpg');
    });

    it('reports an FFmpeg failure instead of returning a missing thumbnail', async () => {
        execFile.mockImplementationOnce((_command, _args, callback) => callback(new Error('FFmpeg failed')));

        await expect(createVideoThumbnail('recording.mp4')).rejects.toThrow('FFmpeg failed');
        expect(stat).not.toHaveBeenCalled();
    });

    it('rejects non-MP4 input', async () => {
        await expect(createVideoThumbnail('recording.mov'))
            .rejects.toThrow('Video thumbnails can only be generated from MP4 recordings.');
        expect(execFile).not.toHaveBeenCalled();
    });
});
