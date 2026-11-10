// A secret from stdin: piped, the whole input; at a terminal, one line typed with echo off, so
// it never lands in the scrollback, the shell history or a process's arguments.
export async function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  try {
    return await new Promise<string>((resolve, reject) => {
      let typed = '';
      const onData = (data: string) => {
        for (const ch of data) {
          if (ch === '\r' || ch === '\n' || ch === '\u0004') {
            stdin.off('data', onData);
            resolve(typed);
            return;
          }
          if (ch === '\u0003') {
            stdin.off('data', onData);
            reject(new Error('cancelled'));
            return;
          }
          if (ch === '\u007f' || ch === '\b') typed = typed.slice(0, -1);
          else typed += ch;
        }
      };
      stdin.on('data', onData);
      stdin.once('end', () => reject(new Error('cancelled')));
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
    process.stderr.write('\n');
  }
}
