import { formatMessage } from './index.mjs';

describe('Can formatMessage', () => {
    it('should format the message correctly', () => {
        // Arrange
        const mainMessage = 'Check this out';
        const cameraName = 'Front Door';
        const recordingUrl = 'http://example.com/recording';
        const expectedMessage = '@channel: <ring://|Front Door> Check this out <http://example.com/recording|View recording>';

        // Act
        const result = formatMessage(mainMessage, recordingUrl, cameraName);

        // Assert
        expect(result).toBe(expectedMessage);
    });

    it('formats the notification without a recording link', () => {
        expect(formatMessage('Motion detected', undefined, 'Back Door'))
            .toBe('@channel: <ring://|Back Door> Motion detected');
    });

    it('formats the notification without a camera name', () => {
        expect(formatMessage('Motion detected')).toBe('@channel: Motion detected');
    });
});
