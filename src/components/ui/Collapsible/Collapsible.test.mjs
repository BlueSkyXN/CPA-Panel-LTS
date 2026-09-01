import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const { Collapsible } = await vite.ssrLoadModule(
  '/src/components/ui/Collapsible/Collapsible.tsx'
);

test.after(async () => {
  await vite.close();
});

test('uses the native open attribute without forwarding defaultOpen to details', () => {
  const consoleErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    consoleErrors.push(args.map(String).join(' '));
  };

  let markup;
  try {
    markup = renderToStaticMarkup(
      createElement(Collapsible, { label: 'Advanced', defaultOpen: true }, 'Content')
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(consoleErrors, []);
  assert.match(markup, /<details[^>]* open=""/);
  assert.doesNotMatch(markup, /defaultopen/i);
});
