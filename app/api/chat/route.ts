import { google } from '@ai-sdk/google';
import { streamText } from 'ai';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const body = await req.json();
  const uiMessages = body.messages || [];

  // Manually convert the new v4 "parts" format into the simple text format Gemini expects
  const simpleMessages = uiMessages.map((m: any) => ({
    role: m.role,
    content: m.parts.map((p: any) => p.text).join(''),
  }));

  const result = streamText({
    // model: google('gemini-1.5-flash'),
    // model: google('gemini-1.5-flash-latest'),
    // model: google('gemini-2.0-flash'),
    model: google('gemini-2.5-flash'),

    system: `You are Bridgi AI, the CRM AI assistant for Narayan S Mahadevan, Founder & CEO.
    You are warm, professional, and concise.
    Always address the user as Narayan.
    Your goal is to help manage accounts, contacts, and interactions.
    Right now, you are just having a simple conversation, but soon you will have access to the CRM database.`,
    messages: simpleMessages,
  });

  return result.toUIMessageStreamResponse();
}