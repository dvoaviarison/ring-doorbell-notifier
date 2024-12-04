// getFormattedDateTime.test.mjs
import { getFormattedDateTime } from './index.mjs';

describe('getFormattedDateTime', () => {
  test('should format the current date and time', () => {
    // Act
    const result = getFormattedDateTime();

    // Assert
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  });

  test('should format a specific date and time', () => {
    // Arrange
    const specificDate = '2024-12-04T01:23:45';

    // Act
    const result = getFormattedDateTime(specificDate);

    // Assert
    expect(result).toBe('2024-12-04_01-23-45');
  });
});
