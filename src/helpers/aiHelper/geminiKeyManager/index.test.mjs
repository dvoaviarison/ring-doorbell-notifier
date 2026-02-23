import GeminiKeyManager from './index.mjs';

describe('GeminiKeyManager', () => {
    test('parses and trims keys from provided envVar', () => {
        const mgr = new GeminiKeyManager(' key1, key2 ,, key3 ');
        expect(mgr.keys).toHaveLength(3);
        expect(mgr.getCurrentKey()).toBe('key1');
    });

    test('handles empty keys gracefully', () => {
        // pass a whitespace-only string so constructor uses the provided
        // value instead of falling back to process.env in CI/dev envs
        const mgr = new GeminiKeyManager('   ');
        expect(mgr.keys).toHaveLength(0);
        expect(mgr.getCurrentKey()).toBeUndefined();
        expect(mgr.getKeyCount()).toBe(0);
        // moveNext should not throw or change anything
        mgr.moveNext();
        expect(mgr.getCurrentKey()).toBeUndefined();
    });
    test('cycles through keys infinitely using modulo', () => {
        const mgr = new GeminiKeyManager('a,b,c');
        const seen = [];
        // take two full rounds
        for (let i = 0; i < mgr.getKeyCount() * 2; i++) {
            seen.push(mgr.getCurrentKey());
            mgr.moveNext();
        }
        expect(seen).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
    });

    test('moveNext wraps back to start for small sets', () => {
        const mgr = new GeminiKeyManager('x,y');
        // there are keys configured
        expect(mgr.getKeyCount()).toBeGreaterThan(0);
        expect(mgr.getCurrentKey()).toBe('x');
        mgr.moveNext();
        expect(mgr.getCurrentKey()).toBe('y');
        mgr.moveNext();
        expect(mgr.getCurrentKey()).toBe('x');
    });
});
