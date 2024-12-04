import { uploadFileToMega } from './index.mjs';

describe('uploadFileToMega', () => {
  it('should upload a file to Mega', async () => {
    // Arrange
    const videoFileName = 'recording.test.mp4';

    // Act
    var link = await uploadFileToMega(videoFileName);

    // Assert
    expect(link).not.toBeNull();
  });
});
