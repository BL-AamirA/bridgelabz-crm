import { google } from '@ai-sdk/google';
import { streamText, generateObject } from 'ai';
import { z } from 'zod';
import { createClient } from '@/lib/supabase';
import { createServerClientInstance } from '@/lib/supabase-server';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();
  const latestMessage = messages[messages.length - 1].parts.map((p: any) => p.text).join('');

  // ==========================================
  // STEP 1: INTENT DETECTION
  // ==========================================
  // We ask Gemini to silently figure out what the user wants
  const { object: intentData } = await generateObject({
    model: google('gemini-2.5-flash'),
    system: `You are an intent classifier. Analyze the user's message and classify it into one of these categories:
    - 'Read': User wants to know the status, details, or history of an account.
    - 'Write': User is providing new meeting notes or creating a new account/contact.
    - 'Chat': General greeting or question not related to specific CRM data.
    
    If the intent is 'Read', extract the exact Company Name the user is asking about. If no company is mentioned, leave it null.`,
    prompt: latestMessage,
    schema: z.object({
      intent: z.enum(['Read', 'Write', 'Chat']),
      companyName: z.string().nullable(),
    }),
  });

  console.log("Detected Intent:", intentData);

  // ==========================================
  // STEP 2: RAG (Retrieval Augmented Generation)
  // ==========================================
  let dbContext = "No specific database context retrieved.";

  // If the user is asking about an account, fetch it from Supabase!
  if (intentData.intent === 'Read' && intentData.companyName) {
    // const supabase = createClient();
    const supabase = await createServerClientInstance(); // Added await here!    
    // Fetch the account
    const { data: account } = await supabase
      .from('accounts')
      .select('*')
      .ilike('name', `%${intentData.companyName}%`)
      .limit(1)
      .single();

    if (account) {
      // Fetch related contacts and interactions to give Gemini full context
      const { data: contacts } = await supabase.from('contacts').select('name, title, email').eq('account_id', account.id);
      const { data: interactions } = await supabase.from('interactions').select('type, notes, date').eq('account_id', account.id).order('date', { ascending: false }).limit(3);

      dbContext = `
        ACCOUNT CONTEXT:
        Name: ${account.name}
        Type: ${account.type}
        Stage: ${account.stage}
        City: ${account.city}
        
        CONTACTS:
        ${contacts?.map(c => `- ${c.name} (${c.title})`).join('\n') || 'None'}
        
        RECENT INTERACTIONS:
        ${interactions?.map(i => `- ${i.date} (${i.type}): ${i.notes}`).join('\n') || 'None'}
      `;
    } else {
      dbContext = `Account "${intentData.companyName}" was not found in the database.`;
    }
  }

  // ==========================================
  // STEP 3: FINAL RESPONSE GENERATION
  // ==========================================
  const result = streamText({
    model: google('gemini-2.5-flash'),
    system: `You are Bridgi AI, the intelligent CRM assistant for Narayan S Mahadevan, Founder & CEO of BridgeLabz.
    You are warm, professional, and concise.
    Always address the user as Narayan.
    
    You have access to the following retrieved database context:
    ${dbContext}
    
    Rules:
    - If the context says the account was not found, politely tell Narayan you couldn't find it.
    - If you have account context, use it to answer Narayan's question accurately.
    - If the intent is just 'Chat', respond normally without forcing database data.`,
    messages: messages.map((m: any) => ({
      role: m.role,
      content: m.parts.map((p: any) => p.text).join('')
    })),
  });

  return result.toUIMessageStreamResponse();
}