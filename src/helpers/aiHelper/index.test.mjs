import { getSnapshotDescription } from './index.mjs';
import { logger } from '../logHelper/index.mjs';

describe('getSnapshotDescription', () => {
    test('should describe the snapshot', async () => {
        // Act
        const result = await getSnapshotDescription('snapshot.test.png', 'Front Door');

        // Assert
        logger.info(result);
        expect(result).not.toBeNull();
    }, 350000);
});
