// Incremental SSE decoder, independent from React and network dependencies.
// Supports chunk splits/CRLF/multiline data and bounds a single unfinished frame.
export class FlowSSEDecoder {
    private buffer = '';
    constructor(private readonly onData: (data: unknown) => void, private readonly maxLength = 8 * 1024 * 1024) { }
    feed(text: string): void {
        this.buffer += text;
        for (;;) {
            const match = /\r?\n\r?\n/.exec(this.buffer);
            if (!match)
                break;
            const frame = this.buffer.slice(0, match.index);
            this.buffer = this.buffer.slice(match.index + match[0].length);
            if (frame.length > this.maxLength)
                throw new Error('Flow status frame too large');
            let event = 'message';
            const data: string[] = [];
            for (const line of frame.split(/\r?\n/)) {
                if (line.startsWith('event:'))
                    event = line.slice(6).trim();
                if (line.startsWith('data:'))
                    data.push(line.slice(5).replace(/^ /, ''));
            }
            if ((event === 'snapshot' || event === 'disabled') && data.length)
                this.onData(JSON.parse(data.join('\n')));
        }
        if (this.buffer.length > this.maxLength)
            throw new Error('Flow status frame too large');
    }
}
