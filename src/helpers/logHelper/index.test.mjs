import { logger } from "./index.mjs";

describe('logger', () => {
    it('should log different levels properly', () => {
        // Act
        logger.info('This is info');
        logger.error('This is error');
    });
});