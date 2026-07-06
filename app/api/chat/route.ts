// import { google } from '@ai-sdk/google';
// import { streamText, generateObject } from 'ai';
// import { z } from 'zod';
// import { createClient } from '@/lib/supabase';
// import { createServerClientInstance } from '@/lib/supabase-server';

// // Allow streaming responses up to 30 seconds
// export const maxDuration = 30;

// export async function POST(req: Request) {
//   const { messages } = await req.json();
//   const latestMessage = messages[messages.length - 1].parts.map((p: any) => p.text).join('');

//   // ==========================================
//   // STEP 1: INTENT DETECTION
//   // ==========================================
//   // We ask Gemini to silently figure out what the user wants
//   const { object: intentData } = await generateObject({
//     model: google('gemini-2.5-flash'),
//     system: `You are an intent classifier. Analyze the user's message and classify it into one of these categories:
//     - 'Read': User wants to know the status, details, or history of an account.
//     - 'Write': User is providing new meeting notes or creating a new account/contact.
//     - 'Chat': General greeting or question not related to specific CRM data.
    
//     If the intent is 'Read', extract the exact Company Name the user is asking about. If no company is mentioned, leave it null.`,
//     prompt: latestMessage,
//     schema: z.object({
//       intent: z.enum(['Read', 'Write', 'Chat']),
//       companyName: z.string().nullable(),
//     }),
//   });

//   console.log("Detected Intent:", intentData);

//   // ==========================================
//   // STEP 2: RAG (Retrieval Augmented Generation)
//   // ==========================================
//   let dbContext = "No specific database context retrieved.";

//   // If the user is asking about an account, fetch it from Supabase!
//   if (intentData.intent === 'Read' && intentData.companyName) {
//     // const supabase = createClient();
//     const supabase = await createServerClientInstance(); // Added await here!    
//     // Fetch the account
//     const { data: account } = await supabase
//       .from('accounts')
//       .select('*')
//       .ilike('name', `%${intentData.companyName}%`)
//       .limit(1)
//       .single();

//     if (account) {
//       // Fetch related contacts and interactions to give Gemini full context
//       const { data: contacts } = await supabase.from('contacts').select('name, title, email').eq('account_id', account.id);
//       const { data: interactions } = await supabase.from('interactions').select('type, notes, date').eq('account_id', account.id).order('date', { ascending: false }).limit(3);
//       const { data: actionItems } = await supabase.from('action_items').select('description, priority, due_date, status').eq('account_id', account.id).order('due_date', { ascending: true });

//       dbContext = `
//         ACCOUNT CONTEXT:
//         Name: ${account.name}
//         Type: ${account.type}
//         Stage: ${account.stage}
//         City: ${account.city}
        
//         CONTACTS:
//         ${contacts?.map(c => `- ${c.name} (${c.title})`).join('\n') || 'None'}
        
//         RECENT INTERACTIONS:
//         ${interactions?.map(i => `- ${i.date} (${i.type}): ${i.notes}`).join('\n') || 'None'}

//         ACTION ITEMS:
//         ${actionItems?.map(a => `- [${a.priority}] ${a.description} (Status: ${a.status}, Due: ${a.due_date || 'No date'})`).join('\n') || 'No open action items'}

//       `;
//     } else {
//       dbContext = `Account "${intentData.companyName}" was not found in the database.`;
//     }
//   }

//   // ==========================================
//   // STEP 3: FINAL RESPONSE GENERATION
//   // ==========================================
//   const result = streamText({
//     model: google('gemini-2.5-flash'),
//     system: `You are Bridgi AI, the intelligent CRM assistant for Narayan S Mahadevan, Founder & CEO of BridgeLabz.
//     You are warm, professional, and concise.
//     Always address the user as Narayan.
    
//     You have access to the following retrieved database context:
//     ${dbContext}
    
//     Rules:
//     - If the context says the account was not found, politely tell Narayan you couldn't find it.
//     - If the intent is just 'Chat', respond normally without forcing database data.
//     - If the context contains account data, you MUST include the Stage, the City, and ALL Contacts listed.
//     - If the context contains recent interactions, summarize them briefly.
//     - If the context contains Action Items, list them clearly with their Priority (P1/P2/P3), Status, and Due Date.
//     - If the context says the account was not found, politely tell Narayan you couldn't find it.
//     - If the intent is just 'Chat', respond normally without forcing database data.
//     - NEVER skip the contacts list if it is provided in the context.`,
//     messages: messages.map((m: any) => ({
//       role: m.role,
//       content: m.parts.map((p: any) => p.text).join('')
//     })),
//   });

//   return result.toUIMessageStreamResponse();
// }

import { google } from '@ai-sdk/google';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { createServerClientInstance } from '@/lib/supabase-server';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const body = await req.json();
  const uiMessages = body.messages || [];

  // ==========================================
  // MESSAGE TRANSLATION, CLEANUP & DEDUPLICATION
  // ==========================================
  let coreMessages = uiMessages
    .map((m: any) => ({
      role: m.role,
      // Clean up weird quotes and join parts
      content: m.parts ? m.parts.map((p: any) => p.text).join(' ').replace(/\"/g, '') : (m.content || ''),
    }))
    .filter(m => m.content && m.content.trim() !== '');

  // Deduplicate
  coreMessages = coreMessages.filter((m, i) => {
    if (i === 0) return true;
    const prev = coreMessages[i - 1];
    return !(m.role === prev.role && m.content === prev.content);
  });

    // ==========================================
  // DETERMINISTIC ROUTING: Don't trust the AI to choose the tool!
  // ==========================================
  const lastUserMessage = coreMessages.filter(m => m.role === 'user').pop()?.content || '';
  const isQuestion = /\?$/.test(lastUserMessage.trim()) || /^(what|who|how|show|list|status|are|is)\b/i.test(lastUserMessage);
  const isNotes = /\b(met|attended|discussed|follow up|had a meeting|called|visited)\b/i.test(lastUserMessage);

  let toolChoice: any = 'auto'; // Default: let AI decide (for normal chat)
  if (isQuestion) {
    console.log("[Router] Detected Question -> Forcing getAccountInfo tool");
    toolChoice = { type: 'tool', toolName: 'getAccountInfo' }; // FORCE READ
  } else if (isNotes) {
    console.log("[Router] Detected Notes -> Forcing captureMeetingNotes tool");
    toolChoice = { type: 'tool', toolName: 'captureMeetingNotes' }; // FORCE WRITE
  }
  // ==========================================

  // ==========================================
  // AGENTIC RAG PIPELINE (via Tool Calling)
  // ==========================================
  const result = await streamText({
    model: google('gemini-2.5-flash'), 
    system: `You are Bridgi AI, the intelligent CRM assistant for Narayan S Mahadevan, Founder & CEO of BridgeLabz.
    You are warm, professional, and concise.
    Always address the user as Narayan.
       
    RULES FOR INTENT DETECTION:
    - If the user provides meeting notes, describes an interaction, or says words like "Met", "Attended", "Discussed", or "Follow up", you MUST use the captureMeetingNotes tool. This saves the data to the database.
    - If the user asks a QUESTION about a company (e.g., "What is the status of X?"), you MUST use the getAccountInfo tool.
    - Do NOT use getAccountInfo if the user is giving you meeting notes! captureMeetingNotes is for SAVING data, getAccountInfo is for READING data.
    
    RULES FOR RENDERING:
    - After the tool returns data, you MUST present it clearly.
    - If the context contains Action Items, list them clearly with their Priority, Status, and Due Date.
    - NEVER skip the contacts list or action items if they are provided by the tool.`,
    
    //     RULES:
    // - If the user asks about a company/account, you MUST use the getAccountInfo tool.
    // - You MUST provide the companyName parameter when calling the tool. Do not leave it blank.
    // - After the tool returns data, you MUST present it clearly.
    // - If the context contains Action Items, list them clearly with their Priority, Status, and Due Date.
    // - If the user is just chatting, respond normally without using tools.
    // - NEVER skip the contacts list or action items if they are provided by the tool.
    // - If the tool returns no action items, say "There are no pending action items for [Company].

    messages: coreMessages,
    
    tools: {
      getAccountInfo: tool({
        description: 'Fetches existing account details, contacts, interactions, and action items from the CRM database. Use this ONLY when the user asks a QUESTION about a specific company (e.g., "What is the status of X?", "Who are the contacts at Y?").',
        parameters: z.object({
          companyName: z.string().describe('The exact name of the company the user is asking about. For example, if the user asks "What about Chitkara?", the companyName must be "Chitkara".'),
          // NEW: Tell the AI to specify what the user cares about
          focus: z.enum(['full', 'status', 'contacts', 'action_items', 'interactions']).describe('What specific information the user is asking about. Use "action_items" if they ask about tasks or to-dos. Use "full" if they ask for a general overview.'),

        }),
        execute: async ({ companyName }) => {
          
          // ====================================================
          // BULLETPROOF FALLBACK: If AI is lazy and passes undefined
          // ====================================================
                    // SAFETY CHECK: If the AI forgets to pass the name, stop and ask the user
                    // SAFETY CHECK: If the AI forgets to pass the name, stop and ask the user
          if (!companyName || companyName.trim() === '') {
            console.log("[Fallback] AI didn't extract the name. Extracting manually...");
            let lastUserMessage = coreMessages.filter(m => m.role === 'user').pop()?.content || '';
            lastUserMessage = lastUserMessage.replace(/"/g, ''); // Remove stray quotes
            
            // Use word boundaries (\b) so we don't match "at" inside "What"
            const match = lastUserMessage.match(/\b(?:for|about|of|at|with)\s+([A-Za-z0-9& ]+?)(?:\?|\.|!|"|$)/i);
            if (match && match[1]) {
              let rawExtraction = match[1].trim();
              console.log(`[Fallback] Raw extraction: ${rawExtraction}`);
              
              // Strip out common CRM query words that might have been captured accidentally
              const crmKeywords = /\b(contacts|action items|tasks|status|details|history|interactions|the|of|for|at|with|are|is)\b/gi;
              let cleanName = rawExtraction.replace(crmKeywords, '').trim();
              
              // Clean up multiple spaces caused by stripping words
              cleanName = cleanName.replace(/\s{2,}/g, ' ').trim();

              // If stripping leaves us with something, use it. Otherwise, use the raw extraction.
              companyName = cleanName.length > 0 ? cleanName : rawExtraction;
              
              console.log(`[Fallback] Successfully extracted: ${companyName}`);
            } else {
              return { error: "No company name was provided. Please ask the user which company they are referring to." };
            }
          }

          console.log(`[RAG Pipeline] Fetching data for company: ${companyName}`);

          const supabase = await createServerClientInstance();
          
          const { data: account } = await supabase
            .from('accounts')
            .select('*')
            .ilike('name', `%${companyName}%`)
            .limit(1)
            .single();

          if (!account) {
            return { found: false, message: `Account "${companyName}" not found in the database.` };
          }

          const { data: contacts } = await supabase.from('contacts').select('name, title, email').eq('account_id', account.id);
          const { data: interactions } = await supabase.from('interactions').select('type, notes, date').eq('account_id', account.id).order('date', { ascending: false }).limit(3);
          const { data: actionItems } = await supabase.from('action_items').select('description, priority, due_date, status').eq('account_id', account.id).order('due_date', { ascending: true });
          
          console.log("RAG Data returned to AI:", JSON.stringify({ account: account.name, contactsCount: contacts?.length, actionsCount: actionItems?.length }));

          return {
            found: true,
            account: { name: account.name, type: account.type, stage: account.stage, city: account.city },
            contacts: contacts || [],
            interactions: interactions || [],
            actionItems: actionItems || []
          };
        },
      }),
            // ==========================================
      // WRITE INTENT TOOL
      // ==========================================
      captureMeetingNotes: tool({
        description: 'Saves meeting notes and interactions to the CRM database. Use this ONLY when the user provides NEW information or describes a past event. Trigger words: "Met", "Attended", "Discussed", "Follow up", "Had a meeting". Do NOT use this if the user is just asking a question.',
          parameters: z.object({
          companyName: z.string().describe('The name of the company discussed.'),
          interactionType: z.enum(['meeting', 'email', 'whatsapp', 'linkedin']).describe('The type of interaction.'),
          interactionNotes: z.string().describe('A brief summary of what was discussed.'),
          contacts: z.array(z.object({
            name: z.string().describe('Full name of the person met or mentioned. You MUST extract every person mentioned in the text.'),
            title: z.string().optional().describe('Job title of the person, if mentioned.'),
          })).describe('Array of ALL people mentioned. If the user says "Praveen attended", Praveen MUST be in this array. Never leave this empty if people are mentioned.'),
          actionItems: z.array(z.object({
            description: z.string().describe('What needs to be done.'),
            priority: z.enum(['P1', 'P2', 'P3']).describe('Priority: P1 (Urgent), P2 (Next Week), P3 (Delegate)'),
            dueDate: z.string().describe('Due date in YYYY-MM-DD format or relative like "Next week"').optional(),
          })).describe('Array of ALL follow-ups, tasks, or next steps mentioned.'),
        }),
        execute: async ({ companyName, interactionType, interactionNotes, contacts, actionItems }) => {
          console.log(`[Write Pipeline] Raw extraction from AI - companyName: ${companyName}`);

          // ======================================================
          // BULLETPROOF FALLBACK: If AI forgets companyName
          // ======================================================
          if (!companyName || companyName.trim() === '') {
            console.log("[Write Fallback] AI didn't extract the company name. Extracting manually...");
            const lastUserMessage = coreMessages.filter(m => m.role === 'user').pop()?.content || '';
            
            // Look for words after "Met", "With", "At"
            const match = lastUserMessage.match(/\b(?:met|with|at|visited)\s+([A-Za-z0-9& ]+?)(?:\s+today|\s+yesterday|\s+this week|\.|,|$)/i);
            if (match && match[1]) {
              companyName = match[1].trim();
              console.log(`[Write Fallback] Successfully extracted: ${companyName}`);
            } else {
              return { success: false, message: "I understood the meeting notes, but I couldn't figure out which company you met with. Could you please specify the company name?" };
            }
          }
          console.log(`[Write Pipeline] Capturing notes for: ${companyName}`);

          // ======================================================
          // DETERMINISTIC FALLBACK: Force extraction if AI was lazy
          // ======================================================
          const lastUserMessage = coreMessages.filter(m => m.role === 'user').pop()?.content || '';

          // If AI forgot to extract contacts, find them manually
          if (!contacts || contacts.length === 0) {
            console.log("[Write Fallback] AI forgot contacts. Extracting manually...");
            // Look for words before "attended", "met", "joined"
            const contactMatches = lastUserMessage.match(/(?:met with|met|attended|joined|was there)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/gi);
            if (contactMatches) {
              contacts = contactMatches.map(c => ({ name: c.replace(/^(met with|met|attended|joined|was there)\s+/i, '').trim() }));
              console.log("[Write Fallback] Extracted contacts:", contacts);
            }
          }

          // If AI forgot to extract action items, find them manually
          if (!actionItems || actionItems.length === 0) {
            console.log("[Write Fallback] AI forgot action items. Extracting manually...");
            // Look for sentences starting with "Follow up", "Action", "Todo"
            const actionMatch = lastUserMessage.match(/(follow up on .*?|action: .*?|todo: .*?)(?:\.|$)/gi);
            if (actionMatch) {
              actionItems = actionMatch.map(a => ({ description: a.trim(), priority: 'P2' }));
              console.log("[Write Fallback] Extracted action items:", actionItems);
            }
          } 
          // ======================================================
          // SUPER FALLBACK: If AI forgot the Due Date, hunt for it!
          // ======================================================
          if (actionItems && actionItems.length > 0) {
            const firstItem = actionItems[0];
                      if (actionItems && actionItems.length > 0) {
            const firstItem = actionItems[0];
            if (!firstItem.dueDate || firstItem.dueDate.trim() === '') {
              console.log("[Write Fallback] AI forgot the due date. Hunting for date...");
              
              // Check for relative words first
              if (/\btomorrow\b/i.test(lastUserMessage)) {
                const d = new Date();
                d.setDate(d.getDate() + 1);
                firstItem.dueDate = d.toISOString().split('T')[0];
                console.log(`[Write Fallback] Found relative date: Tomorrow -> ${firstItem.dueDate}`);
              } else if (/\btoday\b/i.test(lastUserMessage)) {
                firstItem.dueDate = new Date().toISOString().split('T')[0];
                console.log(`[Write Fallback] Found relative date: Today -> ${firstItem.dueDate}`);
              } else {
                // Look for "by [Month Day]"
                const dateMatch = lastUserMessage.match(/(?:by|before|on)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?)/i);
                if (dateMatch && dateMatch[1]) {
                  // ... keep the existing month formatting logic here ...
                  const currentYear = new Date().getFullYear();
                  const monthMap: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
                  const month = monthMap[dateMatch[1].toLowerCase().substring(0, 3)];
                  const day = dateMatch[1].match(/\d{1,2}/)?.[0].padStart(2, '0');
                  if (month && day) {
                    firstItem.dueDate = `${currentYear}-${month}-${day}`;
                    console.log(`[Write Fallback] Found due date: ${firstItem.dueDate}`);
                  }
                } else if (/\bnext week\b/i.test(lastUserMessage)) {
                  const d = new Date();
                  d.setDate(d.getDate() + 7);
                  firstItem.dueDate = d.toISOString().split('T')[0];
                  console.log(`[Write Fallback] Found relative date: Next week -> ${firstItem.dueDate}`);
                }
              }
            }
          }
                      // ======================================================
          // DATE FORMATTER: Convert "Apr 30" to "2026-04-30"
          // ======================================================
          if (actionItems && actionItems.length > 0) {
            const currentYear = new Date().getFullYear();
            const monthMap: Record<string, string> = {
              jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
              jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
            };

            actionItems = actionItems.map(item => {
              let formattedDate = item.dueDate || null;
              let cleanDescription = item.description;

              if (formattedDate) {
                // Try to match "Apr 30" or "April 30"
                const dateMatch = formattedDate.match(/([A-Za-z]+)\s+(\d{1,2})/);
                if (dateMatch) {
                  const month = monthMap[dateMatch[1].toLowerCase().substring(0, 3)];
                  const day = dateMatch[2].padStart(2, '0');
                  if (month && day) {
                    formattedDate = `${currentYear}-${month}-${day}`;
                  }
                } else if (formattedDate.toLowerCase().includes('next week')) {
                  // Handle "next week"
                  const d = new Date();
                  d.setDate(d.getDate() + 7);
                  formattedDate = d.toISOString().split('T')[0];
                }
              }

              // Clean up description so it doesn't say "by Apr 30" at the end
              if (cleanDescription) {
                cleanDescription = cleanDescription.replace(/\s*by\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?/i, '').replace(/\s*by\s+next week/i, '').trim();
              }

              return { ...item, dueDate: formattedDate, description: cleanDescription || item.description };
            });
          }
          
        }
          // ======================================================
          
          const supabase = await createServerClientInstance();
          
          // 1. Find or Create Account
          const { data: account } = await supabase
            .from('accounts')
            .select('id')
            .ilike('name', `%${companyName}%`)
            .limit(1)
            .single();

          let accountId = account?.id;

          if (!accountId) {
            // Auto-create account if it doesn't exist
            const { data: newAccount, error: accError } = await supabase.from('accounts').insert([{ name: companyName, stage: 'Cold' }]).select('id').single();
            if (accError) return { success: false, message: `Error creating account: ${accError.message}` };
            accountId = newAccount.id;
          }

          // 2. Create Interaction
          await supabase.from('interactions').insert([{
            account_id: accountId,
            type: interactionType,
            notes: interactionNotes,
          }]);

          // 3. Create Contacts (Auto-INSERT extracted entities)
          if (contacts && contacts.length > 0) {
            const contactsToInsert = contacts.map(c => ({ account_id: accountId, name: c.name, title: c.title || null }));
            await supabase.from('contacts').insert(contactsToInsert);
          }

          // 4. Create Action Items (Auto-INSERT extracted entities)
          if (actionItems && actionItems.length > 0) {
            const itemsToInsert = actionItems.map(a => ({ account_id: accountId, description: a.description, priority: a.priority, due_date: a.dueDate || null, status: 'open' }));
            await supabase.from('action_items').insert(itemsToInsert);
          }

          return { 
            success: true, 
            message: `Captured ${companyName}, ${contacts?.map(c => c.name).join(', ') || 'no new contacts'}, follow-up ${actionItems?.[0]?.dueDate || 'N/A'}` 
          };
        },
      }),
    },
    toolChoice,
  });

  return result.toUIMessageStreamResponse();
}