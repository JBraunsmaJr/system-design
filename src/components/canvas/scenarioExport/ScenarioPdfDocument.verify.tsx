/**
 * The scenario slide deck, rendered by react-pdf in Node and read back with
 * pdf.js: page count and size, real text, and narration clamped the same way
 * as on images and video.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/canvas/scenarioExport/ScenarioPdfDocument.verify.tsx
 */
import {pdf} from '@react-pdf/renderer';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {frameLayout} from '../../../domain/scenarioExport/scenarioExportPlan';
import {type PdfSlide, ScenarioPdfDocument} from './ScenarioPdfDocument';
import type {ExportTheme} from './composeFrame';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (condition) console.log(`ok: ${message}`);
    else {
        failures++;
        (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
        console.error(`FAIL: ${message}`);
    }
}

// A tiny opaque JPEG standing in for a captured diagram.
const JPEG =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAJABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxCiiirEf/2Q==';

const theme: ExportTheme = {
    background: '#0f1117',
    chrome: '#14161c',
    border: '#2a2e3a',
    text: '#e7e9ee',
    textDim: '#8b90a0',
    accent: '#5b7cfa',
    font: 'Inter',
};

const LONG_TAIL = 'UNIQUE-TAIL-MARKER';
const slides: PdfSlide[] = [
    {
        index: 0,
        title: 'Request arrives',
        narration: 'Client hits the gateway',
        levelLabel: 'Root',
        image: JPEG,
    },
    {
        index: 1,
        title: 'Check credentials',
        narration: 'Lorem ipsum dolor sit amet. '.repeat(60) + LONG_TAIL,
        levelLabel: 'Auth Service',
        image: JPEG,
    },
];

async function render(titleSlide: boolean) {
    const blob = await pdf(
        <ScenarioPdfDocument
            scenarioTitle="Login flow"
            documentTitle="Payments platform"
            slides={slides}
            layout={frameLayout(true, 2)}
            titleSlide={titleSlide}
            theme={theme}
            fontsRegistered={false}
        />,
    ).toBlob();
    const doc = await getDocument({data: new Uint8Array(await blob.arrayBuffer()), verbosity: 0})
        .promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    const [, , width, height] = (await doc.getPage(1)).view;
    return {pages, width, height};
}

async function run() {
    const withCover = await render(true);
    assert(
        withCover.pages.length === 3,
        `a title slide plus one per step (${withCover.pages.length})`,
    );
    assert(
        Math.round(withCover.width) === 960 && Math.round(withCover.height) === 540,
        `16:9 slides (${withCover.width}x${withCover.height})`,
    );
    assert(
        withCover.pages[0].includes('Login flow') && withCover.pages[0].includes('Payments platform'),
        'the title slide names the scenario and document',
    );
    assert(
        withCover.pages[0].includes('Check credentials') && withCover.pages[0].includes('Auth Service'),
        'the title slide lists each step and its level',
    );
    assert(withCover.pages[1].includes('Step 1 of 2'), 'each slide shows its place in the scenario');
    assert(withCover.pages[1].includes('Client hits the gateway'), 'narration is text on the slide');
    assert(withCover.pages[2].includes('Auth Service'), 'a sub-diagram step names its level');
    assert(
        !withCover.pages[2].includes(LONG_TAIL),
        'long narration is clamped to the layout, as on images and video',
    );

    const withoutCover = await render(false);
    assert(withoutCover.pages.length === 2, 'no title slide when turned off');
    assert(withoutCover.pages[0].includes('Request arrives'), 'the deck then starts at step 1');

    if (failures > 0) console.error(`\n${failures} check(s) failed`);
    else console.log('All scenario PDF tests passed.\n');
}

void run();
