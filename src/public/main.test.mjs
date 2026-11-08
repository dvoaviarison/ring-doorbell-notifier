import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

describe('event display descriptions', () => {
    let getEventDisplayDescription;
    let renderEvents;
    const elements = {};

    function createElement() {
        return {
            children: [],
            classList: { add: jest.fn(), toggle: jest.fn() },
            setAttribute: jest.fn(),
            addEventListener: jest.fn(),
            appendChild(child) { this.children.push(child); },
            append(...children) { this.children.push(...children); }
        };
    }

    beforeAll(() => {
        const source = readFileSync('src/public/main.js', 'utf8');
        const context = {
            window: {},
            document: {
                addEventListener: jest.fn(),
                createElement,
                getElementById: (id) => elements[id]
            }
        };
        runInNewContext(source, context);
        getEventDisplayDescription = context.getEventDisplayDescription;
        renderEvents = context.renderEvents;
    });

    it.each([
        [{ cameraName: 'Front door', description: 'Motion detected' }, 'Front door: Motion detected'],
        [{ cameraName: 'Front door', description: 'Front door: Motion detected' }, 'Front door: Motion detected'],
        [{ description: '  Motion detected  ' }, 'Motion detected'],
        [{ cameraName: 'Front door', description: '' }, 'Front door: Camera event'],
        [{}, 'Camera event']
    ])('formats %j for display', (event, expected) => {
        expect(getEventDisplayDescription(event)).toBe(expected);
    });

    it('shows the camera name in the timeline, selected caption, and video title', () => {
        const feed = createElement();
        elements.selectedEventPlayer = createElement();
        elements.selectedEventCaption = createElement();
        renderEvents(feed, [{
            id: '0123456789abcdef01234567',
            timestamp: '2026-11-06T12:00:00.000Z',
            cameraName: 'Front door',
            description: 'Motion detected'
        }]);

        const timelineButton = feed.children[0].children[2];
        expect(timelineButton.children[1].textContent).toBe('Front door: Motion detected');
        expect(elements.selectedEventCaption.children[0].children[0].textContent).toBe('Front door: Motion detected');
        expect(elements.selectedEventPlayer.children[0].title).toBe('Video: Front door: Motion detected');
    });
});
