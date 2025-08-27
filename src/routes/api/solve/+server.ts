import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import OpenAI from 'openai';

// OpenRouter configuration
const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: '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' // Use environment variables for security
});

// Team members
const teamMembers = [
    { name: 'Leader', model: 'cognitivecomputations/dolphin3.0-r1-mistral-24b:free' },
    { name: 'Member1', model: 'google/gemini-2.0-pro-exp-02-05:free' },
    { name: 'Member2', model: 'deepseek/deepseek-r1:free' }
];

// System instructions
const leaderSystem = `
You are the Leader of an AI team designed to solve user problems accurately and efficiently.

1. **Analyze the problem:**
   - If simple, solve it and ask for approval from Member1 and Member2.
   - If complex, break it into subtasks and delegate them to members.

2. **Collaboration:**
   - Assign tasks with precise instructions.
   - Request approval when ready using: "Member1, Member2, please confirm this solution is accurate: [your solution]."

3. **Finalization:**
   - Only finalize after both members approve.
   - Output starts with "SOLUTION FINALIZED:" and ends with "x019898199281x7: [brief summary]."
   - Stop rounds once the solution is approved.
`;

const memberSystem = `
You are a Member in an AI team led by the Leader.

1. **Follow Leader's instructions:**
   - Respond concisely to assigned tasks.
   - Provide accurate solutions without unnecessary details.

2. **Approval Process:**
   - When asked to confirm, respond with "Approved" or give a correction if needed.
   - Do not include "x019898199281x7:" in responses.
`;

async function generateResponse(systemMessage: string, conversation: {name: string | undefined, role: any; content: any; }[], model: string) {
    try {
        const response = await openai.chat.completions.create({
            model,
            messages: [{ role: 'system', content: systemMessage }, ...conversation],
            temperature: 0.4,
            max_tokens: 4000
        });
        return response.choices?.[0]?.message?.content?.trim() || null;
    } catch (e) {
        console.error(`Error generating response from ${model}:`, e);
        return null;
    }
}

export const POST: RequestHandler = async ({ request }) => {
    const { problem } = await request.json();
    if (!problem?.trim()) {
        return json({ error: 'Problem cannot be empty' }, { status: 400 });
    }

    const conversation = [{ role: 'user', content: problem }];
    let leaderResponse = await generateResponse(leaderSystem, conversation, teamMembers[0].model);
    if (!leaderResponse) return json({ error: 'Leader failed to respond' }, { status: 500 });
    conversation.push({ role: 'assistant', content: leaderResponse });

    const maxRounds = 5;
    let finalSolution = null;

    for (let round = 1; round <= maxRounds; round++) {
        if (leaderResponse.includes('please confirm this solution is accurate:')) {
            const [member1Response, member2Response] = await Promise.all([
                generateResponse(memberSystem, conversation, teamMembers[1].model),
                generateResponse(memberSystem, conversation, teamMembers[2].model)
            ]);
            
            if (member1Response) conversation.push({ role: 'assistant', content: member1Response });
            if (member2Response) conversation.push({ role: 'assistant', content: member2Response });
            
            if (member1Response?.includes('Approved') && member2Response?.includes('Approved')) {
                leaderResponse = await generateResponse(leaderSystem, conversation, teamMembers[0].model);
                if (leaderResponse?.includes('SOLUTION FINALIZED:') && leaderResponse.includes('x019898199281x7:')) {
                    finalSolution = leaderResponse;
                    break;
                }
            }
        } else {
            leaderResponse = await generateResponse(leaderSystem, conversation, teamMembers[0].model);
            if (!leaderResponse) continue;
            conversation.push({ role: 'assistant', content: leaderResponse });
        }
    }

    if (!finalSolution) {
        finalSolution = `Unable to fully resolve. Last attempt:\n${leaderResponse}`;
    }

    return json({ final_solution: finalSolution, conversation });
};
