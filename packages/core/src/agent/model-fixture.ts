/** Synthetic protocol events used only by tests and the isolated desktop smoke. */
export function modelFixture(
  protocol: 'responses' | 'chat' | 'anthropic',
  text: string,
  calls: Array<{ id: string; name: string; args: unknown }> = [],
  complete = true,
): string {
  const events: unknown[] = []
  if (protocol === 'responses') {
    const base = { id: 'resp_fixture', created_at: 1, model: 'fixture', status: 'completed' },
      output: unknown[] = []
    events.push({ type: 'response.created', response: base })
    let index = 0
    if (text) {
      const item = {
        type: 'message',
        id: 'msg_fixture',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      }
      events.push(
        {
          type: 'response.output_item.added',
          output_index: index,
          item: { type: 'message', id: 'msg_fixture' },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'msg_fixture',
          output_index: index,
          content_index: 0,
          delta: text,
        },
        { type: 'response.output_item.done', output_index: index, item },
      )
      output.push(item)
      index++
    }
    for (const c of calls) {
      const item = {
        type: 'function_call',
        id: 'fc_' + c.id,
        call_id: c.id,
        name: c.name,
        arguments: JSON.stringify(c.args),
        status: 'completed',
      }
      events.push(
        { type: 'response.output_item.added', output_index: index, item: { ...item, arguments: '' } },
        {
          type: 'response.function_call_arguments.delta',
          item_id: item.id,
          output_index: index,
          delta: item.arguments,
        },
        { type: 'response.output_item.done', output_index: index, item },
      )
      output.push(item)
      index++
    }
    if (complete)
      events.push({
        type: 'response.completed',
        response: {
          ...base,
          output,
          usage: {
            input_tokens: 20,
            output_tokens: 10,
            total_tokens: 30,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      })
  } else if (protocol === 'chat') {
    const chunk = (delta: unknown, finish_reason: string | null) => ({
      id: 'chat_fixture',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'fixture',
      choices: [{ index: 0, delta, finish_reason }],
    })
    events.push(
      chunk(
        {
          role: 'assistant',
          content: text,
          ...(calls.length
            ? {
                tool_calls: calls.map((c, index) => ({
                  index,
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: JSON.stringify(c.args) },
                })),
              }
            : {}),
        },
        null,
      ),
    )
    if (complete) {
      events.push(chunk({}, calls.length ? 'tool_calls' : 'stop'))
      events.push({
        id: 'chat_fixture',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture',
        choices: [],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      })
    }
  } else {
    events.push({
      type: 'message_start',
      message: {
        id: 'msg_fixture',
        type: 'message',
        role: 'assistant',
        model: 'fixture',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 0 },
      },
    })
    let index = 0
    if (text) {
      events.push(
        { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index },
      )
      index++
    }
    for (const c of calls) {
      events.push(
        {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: c.id, name: c.name, input: {} },
        },
        {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(c.args) },
        },
        { type: 'content_block_stop', index },
      )
      index++
    }
    if (complete)
      events.push(
        {
          type: 'message_delta',
          delta: { stop_reason: calls.length ? 'tool_use' : 'end_turn', stop_sequence: null },
          usage: { output_tokens: 10 },
        },
        { type: 'message_stop' },
      )
  }
  return (
    events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') +
    (protocol === 'chat' && complete ? 'data: [DONE]\n\n' : '')
  )
}
