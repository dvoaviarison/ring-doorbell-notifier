import { 
    getRefreshToken,
    storeRefreshToken 
} from './index.mjs';

describe('storeRefreshToken and getRefreshToken', () => {
    test('should store and retrieve the refresh token in MongoDB', async () => {
        // Act
        await storeRefreshToken("your_refresh_token_here");

        // Assert
        const result = await getRefreshToken();
        expect(result).toBe("your_refresh_token_here");
    }, 350000);
});