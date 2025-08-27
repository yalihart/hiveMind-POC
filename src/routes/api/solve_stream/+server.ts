import type { RequestHandler } from './$types';
import OpenAI from 'openai';

// API key and base URL for OpenRouter.
// NOTE: This API key is a placeholder for demonstration purposes.
// In a production app, this should be stored securely in an environment variable.
const OPENROUTER_API_KEY = "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";
const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: OPENROUTER_API_KEY
});

// Team members with their specific models.
const teamMembers = [
    { name: 'Leader', model: 'x-ai/grok-3-mini' },
    { name: 'Member1', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    { name: 'Member2', model: 'mistralai/mistral-small-3.2-24b-instruct:free' }
];

// System messages that define the roles for each AI.
const leaderSystem = `
You are the Leader of an AI team designed to solve user problems accurately and efficiently using multiple AI models. Your role:
- Analyze the user’s problem immediately upon receipt.
- Determine its complexity:
  - If simple (e.g., basic coding, straightforward questions), solve it yourself and propose it to Member1 and Member2 for approval.
  - If complex (e.g., multi-step analysis, optimization needed), break it into specific, concise tasks and assign them to Member1 and Member2 (e.g., "Member1, provide the algorithm; Member2, validate its correctness").
- For all problems:
  - Direct Member1 and Member2 with clear, task-specific prompts if collaboration is needed-DO NOT ASSUME THERE ANSWERS.
  - Review their contributions for accuracy and relevance, providing minimal feedback only if corrections are essential.
  - Prepare a proposed final solution based on your analysis and their input (if applicable).
  - Explicitly request approval from both Member1 and Member2 by stating: "Member1, Member2, please confirm this solution is accurate: [your proposed solution]".
- Deliver the final solution only after receiving explicit approval ("Approved" or similar) from both Member1 and Member2:
  - Start with "SOLUTION FINALIZED:"
  - Provide the complete answer (e.g., code in \`\`\`python blocks, concise explanations).
  - End with "x019898199281x7: [brief summary of the solution]".
- Critical rules:
  - Use "x019898199281x7:" **only** in your final response after both members approve, when the solution is complete and accurate—never in earlier messages.
  - Stop collaboration as soon as the solution is approved and finalized; do not continue unnecessary rounds.
- Efficiency and accuracy are paramount:
  - Aim to solve simple problems in one round (plus approval) and complex ones within 1-3 rounds (plus approval).
  - Include only what is necessary—avoid extra commentary or fluff beyond task delegation and approval requests.
`;

const getMemberSystem = (memberName: string) => `
You are ${memberName} in an AI team led by a Leader, tasked with solving user problems accurately and efficiently. Your role:
- Respond to the Leader’s specific prompts with precise, complete contributions (e.g., code in \`\`\`javascript, brief explanations).
- Fulfill the assigned task fully, addressing potential issues or edge cases relevant to your role.
- Provide concise feedback on the other member’s work only if it improves accuracy or efficiency.
- When the Leader requests approval with "Member1, Member2, please confirm this solution is accurate: [proposed solution]":
  - Review the proposed solution carefully for correctness and completeness.
  - Respond with "Approved" if accurate, or provide a concise correction (e.g., "Not accurate: [specific issue]") if it needs adjustment.
- Focus on:
  - Accuracy: Ensure your contributions and approvals uphold the highest standard of correctness.
  - Efficiency: Deliver only what is needed, avoiding unnecessary details.
- Do not:
  - Address the user directly—your input is for the Leader.
  - Include "x019898199281x7:" in your responses—this is reserved for the Leader’s final solution.
- Adapt to the problem type and the Leader’s instructions, contributing effectively to the team’s goal of a fast, accurate solution.
`;

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

// A helper function to generate a response from the OpenAI API (via OpenRouter).
async function generateResponse(systemMessage: string, conversation: Message[], model: string): Promise<string | null> {
    try {
        const response = await openai.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: systemMessage },
                ...conversation
            ],
            temperature: 0.4,
            max_tokens: 4000
        });
        if (!response.choices?.length) throw new Error('No choices returned from the API');
        return response.choices[0].message.content.trim();
    } catch (e) {
        console.error(`Error generating response from ${model}: ${e}`);
        return null;
    }
}

// The main SvelteKit request handler.
export const POST: RequestHandler = async ({ request }) => {
    const { problem } = await request.json();
    if (!problem?.trim() || problem.length > 5000) {
        return new Response(JSON.stringify({ error: 'Problem cannot be empty or exceed 5000 characters' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Initialize the conversation with the user's problem.
    const conversation: Message[] = [
        { role: 'user', content: problem }
    ];

    const stream = new ReadableStream({
        async start(controller) {
            // Step 1: Leader begins the conversation.
            let leaderResponse = await generateResponse(leaderSystem, conversation, teamMembers[0].model);
            if (!leaderResponse) {
                controller.enqueue(`data: ${JSON.stringify({ error: 'Leader failed to respond' })}\n\n`);
                controller.close();
                return;
            }
            conversation.push({ role: 'assistant', content: leaderResponse });
            controller.enqueue(`data: ${JSON.stringify({ member: teamMembers[0].name, content: leaderResponse })}\n\n`);

            const maxRounds = 5; // Limiting rounds to prevent infinite loops

            for (let round = 1; round <= maxRounds; round++) {
                const isApprovalPhase = leaderResponse.includes('please confirm this solution is accurate:');
                let member1Approved = false;
                let member2Approved = false;

                // Step 2: Members respond concurrently.
                const [member1Response, member2Response] = await Promise.all([
                    generateResponse(getMemberSystem(teamMembers[1].name), conversation, teamMembers[1].model),
                    generateResponse(getMemberSystem(teamMembers[2].name), conversation, teamMembers[2].model)
                ]);

                // Enqueue member responses and update conversation history.
                if (member1Response) {
                    conversation.push({ role: 'assistant', content: member1Response });
                    controller.enqueue(`data: ${JSON.stringify({ member: teamMembers[1].name, content: member1Response })}\n\n`);
                    if (isApprovalPhase && /\b(Approved|Approve|I approve)\b/i.test(member1Response)) {
                        member1Approved = true;
                    }
                }
                if (member2Response) {
                    conversation.push({ role: 'assistant', content: member2Response });
                    controller.enqueue(`data: ${JSON.stringify({ member: teamMembers[2].name, content: member2Response })}\n\n`);
                    if (isApprovalPhase && /\b(Approved|Approve|I approve)\b/i.test(member2Response)) {
                        member2Approved = true;
                    }
                }

                // Step 3: Leader responds again, potentially finalizing.
                leaderResponse = await generateResponse(leaderSystem, conversation, teamMembers[0].model);
                if (!leaderResponse) {
                    controller.enqueue(`data: ${JSON.stringify({ error: 'Leader failed to respond' })}\n\n`);
                    continue;
                }
                conversation.push({ role: 'assistant', content: leaderResponse });
                controller.enqueue(`data: ${JSON.stringify({ member: teamMembers[0].name, content: leaderResponse })}\n\n`);

                // Check for finalization and exit.
                if (leaderResponse.includes('SOLUTION FINALIZED:') && leaderResponse.includes('x019898199281x7:')) {
                    const finalizedMatch = leaderResponse.match(/SOLUTION FINALIZED:(.*?)x019898199281x7:/s);
                    if (finalizedMatch) {
                        const finalSolution = finalizedMatch[1].trim();
                        controller.enqueue(`data: ${JSON.stringify({ final_solution: finalSolution })}\n\n`);
                    }
                    controller.enqueue(`data: ${JSON.stringify({ status: 'completed' })}\n\n`);
                    controller.close();
                    return;
                }
            }

            // If max rounds are reached without a solution, close the stream.
            controller.enqueue(`data: ${JSON.stringify({ error: 'Max rounds reached without a final solution.' })}\n\n`);
            controller.enqueue(`data: ${JSON.stringify({ status: 'completed' })}\n\n`);
            controller.close();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
};
