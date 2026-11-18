jest.mock('megajs', () => ({
    Storage: jest.fn().mockImplementation(() => ({
        ready: Promise.resolve({
            upload: jest.fn().mockReturnValue({
                complete: Promise.resolve({ link: jest.fn().mockResolvedValue('https://mega.example/file') })
            })
        })
    }))
}));

jest.mock('fs', () => ({ createReadStream: jest.fn(() => 'video-stream') }));
jest.mock('fs/promises', () => ({ stat: jest.fn().mockResolvedValue({ size: 12 }) }));
jest.mock('../fileHelper/index.mjs', () => ({
    checkFileExists: jest.fn().mockResolvedValue(true),
    purgeLocalFiles: jest.fn()
}));
jest.mock('../pendingUploadHelper/index.mjs', () => ({ trackPendingUpload: jest.fn(() => jest.fn()) }));

import { Storage } from 'megajs';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { checkFileExists, purgeLocalFiles } from '../fileHelper/index.mjs';
import { trackPendingUpload } from '../pendingUploadHelper/index.mjs';
import { openMegaStorage, uploadFileToMega } from './index.mjs';

describe('MEGA uploads', () => {
    const credentials = { email: 'owner@example.com', password: 'owner-password' };
    const previousRecordingFolder = process.env.APP_RECORDING_FOLDER;

    beforeEach(() => {
        process.env.APP_RECORDING_FOLDER = '/recordings';
        jest.clearAllMocks();
        checkFileExists.mockResolvedValue(true);
        stat.mockResolvedValue({ size: 12 });
    });

    afterAll(() => {
        if (previousRecordingFolder === undefined) delete process.env.APP_RECORDING_FOLDER;
        else process.env.APP_RECORDING_FOLDER = previousRecordingFolder;
    });

    it('uploads with the supplied owner credentials', async () => {
        await expect(uploadFileToMega('recording.mp4', credentials))
            .resolves.toBe('https://mega.example/file');

        expect(Storage).toHaveBeenCalledWith({
            ...credentials,
            userAgent: 'RingDoorbellNotifier'
        });
        expect(checkFileExists).toHaveBeenCalledWith('/recordings/recording.mp4');
        expect(createReadStream).toHaveBeenCalledWith('/recordings/recording.mp4');
        expect(stat).toHaveBeenCalledWith('/recordings/recording.mp4');
        expect(trackPendingUpload).toHaveBeenCalledWith('/recordings/recording.mp4');
        expect(purgeLocalFiles).toHaveBeenCalled();
        const storage = await Storage.mock.results[0].value.ready;
        expect(storage.upload).toHaveBeenCalledWith(
            { name: 'recording.mp4', size: 12 },
            'video-stream'
        );
    });

    it('requires owner credentials', async () => {
        expect(() => openMegaStorage()).toThrow('MEGA email and password are required.');
        await expect(uploadFileToMega('recording.mp4')).rejects.toThrow('MEGA email and password are required.');
        expect(Storage).not.toHaveBeenCalled();
    });
});
