import { 
    getSnapshotDescriptionViaOllama, 
    getSnapshotDescriptionViaTogetherAI, 
    getSnapshotDescriptionViaGemini } from './index.mjs';
import { logger } from '../logHelper/index.mjs';

describe('getSnapshotDescriptionViaOllama', () => {
    test('should describe the snapshot', async () => {
        // Act
        const result = await getSnapshotDescriptionViaOllama('snapshot.test.png', 'Front Door');

        // Assert
        logger.info(result);
        expect(result).not.toBeNull();
    }, 350000);
});

describe('getSnapshotDescriptionViaTogetherAI', () => {
    test('should describe the snapshot via Together AI', async () => {
        // Act
        const result = await getSnapshotDescriptionViaTogetherAI('snapshot.test.png', 'Front Door');

        // Assert
        logger.info(result);
        expect(result).not.toBeNull();
    }, 350000);
});

describe('getSnapshotDescriptionViaGemini', () => {
    test('should describe the snapshot via Gemini AI', async () => {
        // Act
        const result = await getSnapshotDescriptionViaGemini('snapshot.test.png', 'Front Door');

        // Assert
        logger.info(result);
        expect(result).not.toBeNull();
    }, 350000);
});
