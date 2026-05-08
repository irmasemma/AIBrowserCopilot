// Live integration test for ALL three providers, importing the actual production
// adapter code (no copy-paste, no mock — same code that runs in the extension).
//
// - Anthropic: real round-trip with $ANTHROPIC_TEST_KEY (verifies wire shape and parsing live).
// - OpenAI: contract test against fetch mock fed a documented response shape.
// - Gemini: contract test against fetch mock fed a documented response shape.
//
// Run: node --import tsx tools/live-test-providers.mjs
//      (or `npx tsx tools/live-test-providers.mjs`)
//
// Exit code: 0 if all pass, 1 on any failure. Loud + skeptical output.

import { callAnthropic, _internal as anthInternal } from '../packages/extension/src/sidepanel/providers/anthropic.js';
import { callOpenAI } from '../packages/extension/src/sidepanel/providers/openai.js';
import { callGemini } from '../packages/extension/src/sidepanel/providers/gemini.js';

const FAILS = [];
const ok = (label) => console.log(`  PASS  ${label}`);
const fail = (label, why) => {
  console.log(`  FAIL  ${label}`);
  console.log(`        ${why}`);
  FAILS.push(label);
};

const sampleTools = [
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description: "List all of the user's open browser tabs with titles and URLs.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional substring to filter tabs by.' },
        },
      },
    },
  },
];

// =====================================================================
// 1. Live Anthropic round trip
// =====================================================================
console.log('\n=== Anthropic (LIVE) ===');
const anthKey = process.env.ANTHROPIC_TEST_KEY;
if (!anthKey) {
  console.log('  SKIP  no ANTHROPIC_TEST_KEY set');
} else {
  try {
    // Turn 1: model decides to call the tool.
    const r1 = await callAnthropic({
      apiKey: anthKey,
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'system', text: 'Be concise. Always use the list_tabs tool when asked about tabs.' },
        { role: 'user', text: 'What tabs do I have open?' },
      ],
      tools: sampleTools,
    });
    if (r1.finishReason !== 'tool_use') throw new Error(`expected tool_use, got ${r1.finishReason}`);
    if (r1.toolCalls.length !== 1) throw new Error(`expected 1 tool call, got ${r1.toolCalls.length}`);
    if (r1.toolCalls[0].name !== 'list_tabs') throw new Error(`expected list_tabs, got ${r1.toolCalls[0].name}`);
    ok(`turn 1 → tool_use: ${r1.toolCalls[0].name} id=${r1.toolCalls[0].id}`);

    // Turn 2: provide a tool result, expect a final answer.
    const r2 = await callAnthropic({
      apiKey: anthKey,
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'system', text: 'Be concise. Always use the list_tabs tool when asked about tabs.' },
        { role: 'user', text: 'What tabs do I have open?' },
        { role: 'assistant', text: '', toolCalls: r1.toolCalls },
        {
          role: 'tool',
          text: JSON.stringify([
            { id: 1, title: 'GitHub', url: 'https://github.com/' },
            { id: 2, title: 'Gmail', url: 'https://mail.google.com/' },
          ]),
          toolCallId: r1.toolCalls[0].id,
          toolName: r1.toolCalls[0].name,
        },
      ],
      tools: sampleTools,
    });
    if (r2.finishReason !== 'stop') throw new Error(`expected stop, got ${r2.finishReason}`);
    if (!r2.assistantText.trim()) throw new Error('expected non-empty final text');
    ok(`turn 2 → stop, text: ${r2.assistantText.slice(0, 80).replace(/\s+/g, ' ')}…`);
  } catch (err) {
    fail('Anthropic live round-trip', err.message);
  }
}

// =====================================================================
// 2. OpenAI contract test (fetch is mocked, but the production code is real)
// =====================================================================
console.log('\n=== OpenAI (contract) ===');
{
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: { name: 'list_tabs', arguments: '{"query":"github"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    const r = await callOpenAI({
      apiKey: 'sk-fake',
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', text: 'sys' },
        { role: 'user', text: 'find my github tab' },
      ],
      tools: sampleTools,
    });
    if (captured.url !== 'https://api.openai.com/v1/chat/completions') throw new Error(`URL ${captured.url}`);
    if (captured.init.headers.Authorization !== 'Bearer sk-fake') throw new Error('missing Authorization header');
    const body = JSON.parse(captured.init.body);
    if (body.model !== 'gpt-4.1-mini') throw new Error(`model ${body.model}`);
    if (!body.tools || body.tools.length !== 1) throw new Error(`tools length ${body.tools?.length}`);
    if (body.tools[0].type !== 'function') throw new Error('tools[0].type');
    if (body.tool_choice !== 'auto') throw new Error('tool_choice');
    if (body.messages.length !== 2) throw new Error(`messages length ${body.messages.length}`);
    if (r.finishReason !== 'tool_use') throw new Error(`finishReason ${r.finishReason}`);
    if (r.toolCalls.length !== 1) throw new Error(`toolCalls.length ${r.toolCalls.length}`);
    if (r.toolCalls[0].id !== 'call_abc') throw new Error('id');
    if (r.toolCalls[0].name !== 'list_tabs') throw new Error('name');
    if (r.toolCalls[0].args.query !== 'github') throw new Error('args parsing');
    ok('wire shape, tool parsing, finish reason');
  } catch (err) {
    fail('OpenAI contract', err.message);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// =====================================================================
// 3. Gemini contract test
// =====================================================================
console.log('\n=== Gemini (contract) ===');
{
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'Let me check.' },
                { functionCall: { id: 'gem-1', name: 'list_tabs', args: { query: 'github' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    const r = await callGemini({
      apiKey: 'AIza-fake',
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', text: 'sys' },
        { role: 'user', text: 'find my github tab' },
      ],
      tools: sampleTools,
    });
    if (!captured.url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/')) {
      throw new Error(`URL ${captured.url}`);
    }
    if (!captured.url.includes(':generateContent?key=AIza-fake')) {
      throw new Error('expected query-param API key');
    }
    if (captured.init.headers.Authorization) throw new Error('Should not send Authorization header');
    const body = JSON.parse(captured.init.body);
    if (!body.contents || body.contents.length !== 1) throw new Error(`contents length ${body.contents?.length}`);
    if (body.contents[0].role !== 'user') throw new Error('user role');
    if (!body.systemInstruction) throw new Error('systemInstruction missing');
    if (body.systemInstruction.parts[0].text !== 'sys') throw new Error('systemInstruction content');
    if (!body.tools || body.tools.length !== 1) throw new Error('tools missing');
    if (!body.tools[0].functionDeclarations) throw new Error('functionDeclarations missing');
    if (body.tools[0].functionDeclarations[0].name !== 'list_tabs') throw new Error('decl name');
    if (r.finishReason !== 'tool_use') throw new Error(`finishReason ${r.finishReason}`);
    if (r.assistantText !== 'Let me check.') throw new Error(`text: ${r.assistantText}`);
    if (r.toolCalls.length !== 1) throw new Error(`toolCalls.length ${r.toolCalls.length}`);
    if (r.toolCalls[0].name !== 'list_tabs') throw new Error('name');
    if (r.toolCalls[0].args.query !== 'github') throw new Error('args.query');
    ok('wire shape, query-param auth, schema sanitization, parsing');
  } catch (err) {
    fail('Gemini contract', err.message);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// =====================================================================
// 4. Anthropic API endpoint smoke (verify URL constant + dangerous header)
// =====================================================================
console.log('\n=== Anthropic (header contract) ===');
{
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    await callAnthropic({
      apiKey: 'sk-ant-fake',
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'system', text: 'be helpful' },
        { role: 'user', text: 'hi' },
      ],
      tools: [],
    });
    if (captured.url !== 'https://api.anthropic.com/v1/messages') throw new Error(`URL ${captured.url}`);
    const h = captured.init.headers;
    if (h['x-api-key'] !== 'sk-ant-fake') throw new Error('x-api-key');
    if (h['anthropic-version'] !== '2023-06-01') throw new Error('anthropic-version');
    if (h['anthropic-dangerous-direct-browser-access'] !== 'true') {
      throw new Error('anthropic-dangerous-direct-browser-access missing — extension calls will fail in browser context');
    }
    const body = JSON.parse(captured.init.body);
    if (body.system !== 'be helpful') throw new Error('system extracted to top-level');
    if (body.messages.length !== 1) throw new Error('system removed from array');
    if (body.messages[0].role !== 'user') throw new Error('user role');
    if (typeof body.max_tokens !== 'number' || body.max_tokens <= 0) throw new Error('max_tokens missing');
    ok('headers, system extraction, max_tokens, URL');
  } catch (err) {
    fail('Anthropic headers', err.message);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// =====================================================================
// Summary
// =====================================================================
console.log('\n' + '='.repeat(60));
if (FAILS.length === 0) {
  console.log('ALL PROVIDER ADAPTERS VERIFIED ✓');
  process.exit(0);
} else {
  console.log(`${FAILS.length} FAILURE${FAILS.length === 1 ? '' : 'S'}:`);
  for (const f of FAILS) console.log(`  - ${f}`);
  process.exit(1);
}
