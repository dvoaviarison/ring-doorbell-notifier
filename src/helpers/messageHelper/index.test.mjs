import { formatMessage } from './index.mjs';

describe('Can formatMessage', () => {
    it('should format the message correctly', () => {
        // Arrange
        const mainMessage = 'Check this out';
        const recordingUrl = 'http://example.com/recording';
        const expectedMessage = '@channel: Check this out: <http://example.com/recording|View recording>';

        // Act
        const result = formatMessage(mainMessage, recordingUrl);

        // Assert
        expect(result).toBe(expectedMessage);
    });
});
