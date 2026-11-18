jest.mock('megajs', () => ({ File: { fromURL: jest.fn(link => ({ nodeId: link.split('/').pop().split('#')[0] })) } }));
jest.mock('../dbHelper/index.mjs', () => ({
    getOldestVideoEventsToArchive: jest.fn(),
    markVideoEventsArchived: jest.fn()
}));
jest.mock('../uploadHelper/index.mjs', () => ({ openMegaStorage: jest.fn() }));
jest.mock('../logHelper/index.mjs', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));

import { getOldestVideoEventsToArchive, markVideoEventsArchived } from '../dbHelper/index.mjs';
import { openMegaStorage } from '../uploadHelper/index.mjs';
import { archiveOldEventsIfStorageFull } from './index.mjs';

describe('archiveOldEventsIfStorageFull', () => {
    let now = Date.now();
    beforeEach(() => {
        now += 11 * 60 * 1000;
        jest.useFakeTimers().setSystemTime(now);
    });
    afterEach(() => jest.useRealTimers());

    const video = { delete: jest.fn() };
    const thumbnail = { delete: jest.fn() };
    const storage = {
        close: jest.fn(),
        getAccountInfo: jest.fn(),
        files: { video, thumb: thumbnail }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        openMegaStorage.mockResolvedValue(storage);
    });

    it('does nothing below 90% usage', async () => {
        storage.getAccountInfo.mockResolvedValue({ spaceUsed: 89, spaceTotal: 100 });

        await expect(archiveOldEventsIfStorageFull()).resolves.toBe(0);

        expect(getOldestVideoEventsToArchive).not.toHaveBeenCalled();
    });

    it('deletes videos and thumbnails then archives the events at 90% usage', async () => {
        storage.getAccountInfo.mockResolvedValue({ spaceUsed: 90, spaceTotal: 100 });
        getOldestVideoEventsToArchive.mockResolvedValue([
            { id: 'a', megaLink: 'https://mega.nz/file/video#k', thumbnailLink: 'https://mega.nz/file/thumb#k' },
            { id: 'b', megaLink: 'https://mega.nz/file/missing#k' }
        ]);

        await expect(archiveOldEventsIfStorageFull()).resolves.toBe(2);

        expect(video.delete).toHaveBeenCalledWith(true);
        expect(thumbnail.delete).toHaveBeenCalledWith(true);
        expect(markVideoEventsArchived).toHaveBeenCalledWith(['a', 'b']);
    });

    it('leaves events unarchived when a deletion fails', async () => {
        storage.getAccountInfo.mockResolvedValue({ spaceUsed: 95, spaceTotal: 100 });
        video.delete.mockRejectedValueOnce(new Error('boom'));
        getOldestVideoEventsToArchive.mockResolvedValue([{ id: 'a', megaLink: 'https://mega.nz/file/video#k' }]);

        await expect(archiveOldEventsIfStorageFull()).resolves.toBe(0);

        expect(markVideoEventsArchived).toHaveBeenCalledWith([]);
    });

    it('skips checks made within ten minutes of the last one', async () => {
        storage.getAccountInfo.mockResolvedValue({ spaceUsed: 10, spaceTotal: 100 });
        await archiveOldEventsIfStorageFull();
        jest.setSystemTime(now + 60 * 1000);

        await archiveOldEventsIfStorageFull();

        expect(openMegaStorage).toHaveBeenCalledTimes(1);
        expect(storage.close).toHaveBeenCalledTimes(1);
    });
});
