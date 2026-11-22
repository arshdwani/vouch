// Forge LLM access. Only the grounded writer uses it (prompt and checks are in core/grounded.js). Every failure
// returns null, so drafting falls back to the deterministic extract.
import { chat, list } from '@forge/llm';
import { SYSTEM_PROMPT, userPrompt } from './core/grounded.js';

let model; // undefined = not checked yet in this invocation, null = unavailable

export async function llmModel() {
  if (model !== undefined) return model;
  try {
    const r = await list();
    const active = (r?.models || []).filter((m) => m.status !== 'deprecated').map((m) => m.model);
    model = active.find((m) => /haiku/.test(m)) || active.find((m) => /sonnet/.test(m)) || active[0] || null;
  } catch (e) {
    console.warn('Vouch: Forge LLM unavailable', e?.message || e);
    model = null;
  }
  return model;
}

const textOf = (res) => {
  const c = res?.choices?.[0]?.message?.content;
  return Array.isArray(c) ? c.map((x) => x?.text || '').join('') : String(c ?? '');
};

/** One grounded answer: returns the raw reply text, or null when the LLM is unavailable or fails. */
export async function writeGrounded(question, passages, { yesNo } = {}) {
  const m = await llmModel();
  if (!m) return null;
  try {
    const res = await chat({
      model: m,
      temperature: 0,
      max_completion_tokens: 400,
      messages: [
        { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT }] },
        { role: 'user', content: [{ type: 'text', text: userPrompt(question, passages, { yesNo }) }] },
      ],
    });
    return textOf(res);
  } catch (e) {
    console.warn('Vouch: LLM call failed', e?.message || e);
    return null;
  }
}
