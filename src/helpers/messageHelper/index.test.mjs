import { formatMessage, removeSlackChannelPrefix } from './index.mjs';

describe('Can formatMessage', () => {
    it('should format the message correctly', () => {
        // Arrange
        const mainMessage = 'Check this out';
        const recordingUrl = 'http://example.com/recording';
        const expectedMessage = '@channel: Check this out <http://example.com/recording|View recording>';

        // Act
        const result = formatMessage(mainMessage, recordingUrl);

        // Assert
        expect(result).toBe(expectedMessage);
    });

    describe('removeSlackChannelPrefix', () => {
        it.each([
            ['@channel: Motion detected', 'Motion detected'],
            ['  @CHANNEL @channel: Motion detected', 'Motion detected'],
            ['@channeler detected', '@channeler detected'],
            ['Motion detected', 'Motion detected'],
            [null, null]
        ])('normalizes %j', (input, expected) => {
            expect(removeSlackChannelPrefix(input)).toBe(expected);
        });
    });

    it('formats the notification without a recording link', () => {
        expect(formatMessage('Motion detected')).toBe('@channel: Motion detected');
    });
});
