// Live test: full tool-calling round trip with Anthropic.
// Verifies the exact wire shapes our extension code will produce.

const key = process.env.ANTHROPIC_TEST_KEY;
if (!key) throw new Error('Set ANTHROPIC_TEST_KEY');

const tools = [
  {
    name: 'get_weather',
    description: 'Get current weather for a city. Returns temperature in Celsius and a condition string.',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name like Paris or Tokyo' },
      },
      required: ['city'],
    },
  },
];

async function call(messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      tools,
      messages,
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    console.log('HTTP', r.status, JSON.stringify(data));
    process.exit(1);
  }
  return data;
}

(async () => {
  const messages = [
    { role: 'user', content: "What's the weather in Tokyo? Use the tool." },
  ];

  // Turn 1: model should request tool_use.
  const t1 = await call(messages);
  console.log('--- Turn 1 ---');
  console.log('stop_reason:', t1.stop_reason);
  console.log('content blocks:', t1.content.map(b => b.type).join(','));

  if (t1.stop_reason !== 'tool_use') {
    console.log('FAIL: expected stop_reason=tool_use, got', t1.stop_reason);
    process.exit(1);
  }

  const toolUse = t1.content.find(b => b.type === 'tool_use');
  console.log('tool_use.name:', toolUse.name);
  console.log('tool_use.input:', JSON.stringify(toolUse.input));

  // Append assistant reply, then send a tool_result.
  messages.push({ role: 'assistant', content: t1.content });
  messages.push({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: '14°C, partly cloudy',
      },
    ],
  });

  // Turn 2: model should reply with end_turn + plain text.
  const t2 = await call(messages);
  console.log('--- Turn 2 ---');
  console.log('stop_reason:', t2.stop_reason);
  const text = t2.content.filter(b => b.type === 'text').map(b => b.text).join('');
  console.log('reply text:', text);
  console.log('PASS: round-trip OK');
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
