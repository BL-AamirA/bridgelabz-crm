import { google } from '@ai-sdk/google';
import { generateEmbedding } from '@/lib/embeddings';
import { streamText } from 'ai';
import { z } from 'zod';
import { createServerClientInstance } from '@/lib/supabase-server';
import { redis } from '@/lib/redis';

// ==========================================
// TYPE DEFINITIONS
// ==========================================
type ReadToolResult = {
  error?: string;
  found?: boolean;
  message?: string;
  account?: any;
  contacts?: any[];
  interactions?: any[];
  actionItems?: any[];
  semanticMatches?: any[]; // NEW: for vector search results
};

type WriteToolResult = {
  success?: boolean;
  message?: string;
};

type DigestToolResult = {
  error?: string;
  overdueActions?: any[];
  staleAccounts?: any[];
};

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
      content: m.parts ? m.parts.map((p: any) => p.text).join(' ').replace(/\"/g, '') : (m.content || ''),
    }))
    .filter((m: any) => m.content && m.content.trim() !== '');

  coreMessages = coreMessages.filter((m: any, i: number) => {
    if (i === 0) return true;
    const prev = coreMessages[i - 1];
    return !(m.role === prev.role && m.content === prev.content);
  });

    // ==========================================
  // DETERMINISTIC ROUTING
  // ==========================================
  const lastUserMessage = coreMessages
    .filter((m: any) => m.role === 'user')
    .pop()?.content || '';
  const isDigest = /\b(plate|digest|today|tasks|todo)\b/i.test(lastUserMessage) && /\b(what|my|give|show)\b/i.test(lastUserMessage);
  const isQuestion = /\?$/.test(lastUserMessage.trim()) || /^(what|who|how|show|list|status|are|is)\b/i.test(lastUserMessage);
  const isNotes = /\b(met|attended|discussed|follow up|had a meeting|called|visited)\b/i.test(lastUserMessage) && !isQuestion;

  let toolChoice: any = 'auto';
  if (isDigest) {
    console.log("[Router] Detected Digest Request -> Forcing getDailyDigest tool");
    toolChoice = { type: 'tool', toolName: 'getDailyDigest' };
  } else if (isQuestion) {
    console.log("[Router] Detected Question -> Forcing getAccountInfo tool");
    toolChoice = { type: 'tool', toolName: 'getAccountInfo' };
  } else if (isNotes) {
    console.log("[Router] Detected Notes -> Forcing captureMeetingNotes tool");
    toolChoice = { type: 'tool', toolName: 'captureMeetingNotes' };
  }

  // ==========================================
  // TOOL DEFINITIONS (Plain objects to bypass TS bug)
  // ==========================================
  const getAccountInfoTool = {
    description: 'Fetches existing account details, contacts, interactions, and action items from the CRM database. Use this ONLY when the user asks a QUESTION about a specific company (e.g., "What is the status of X?", "Who are the contacts at Y?").',
    parameters: z.object({
      companyName: z.string().describe('The exact name of the company the user is asking about.'),
      focus: z.string().describe('What specific information the user is asking about. Possible values: "full", "status", "contacts", "action_items", "interactions".'),
    }),
    execute: async ({ companyName, focus }: { companyName: string; focus: string }): Promise<ReadToolResult> => {
          
      if (!companyName || companyName.trim() === '') {
        console.log("[Read Fallback] AI didn't extract the name. Extracting manually...");
        let lastUserMessage = coreMessages.filter((m: any) => m.role === 'user').pop()?.content || '';
        lastUserMessage = lastUserMessage.replace(/"/g, '');
        
        let match = lastUserMessage.match(/\b(?:at|for|of|with|about)\s+([A-Z][a-z0-9&]+(?:\s[A-Z][a-z0-9&]+)*)/);
        if (match && match[1]) {
          companyName = match[1].trim();
        } else {
          // Fallback 2: Just grab the last capitalized word before the question mark (e.g., "status of Kyndryl?")
          const lastWordMatch = lastUserMessage.match(/([A-Z][a-z0-9&]+(?:\s[A-Z][a-z0-9&]+)*)\s*\?/);
          if (lastWordMatch && lastWordMatch[1]) {
            companyName = lastWordMatch[1].trim();
          } else {
            return { error: "No company name was provided. Please ask the user which company they are referring to." };
          }
        }
      }

      console.log(`[RAG Pipeline] Fetching data for company: ${companyName}`);
      const supabase = await createServerClientInstance();
      
      const { data: account } = await supabase.from('accounts').select('*').ilike('name', `%${companyName}%`).limit(1).single();
      if (!account) return { found: false, message: `Account "${companyName}" not found in the database.` };

      const { data: contacts } = await supabase.from('contacts').select('name, title, email').eq('account_id', account.id);
      const { data: interactions } = await supabase.from('interactions').select('type, notes, date').eq('account_id', account.id).order('date', { ascending: false }).limit(3);
      // Filter out blank interactions so the AI doesn't see them
      const cleanInteractions = (interactions || []).filter((int: any) => int.notes && int.notes.trim() !== '');      const { data: actionItems } = await supabase.from('action_items').select('description, priority, due_date, status').eq('account_id', account.id).order('due_date', { ascending: true });
      
      // ==========================================
      // SEMANTIC SEARCH (Vector Search)
      // ==========================================
      let semanticMatches: any[] = [];
      console.log("[Semantic Search] Embedding user query...");
      const queryEmbedding = await generateEmbedding(lastUserMessage);
      
      if (queryEmbedding) {
        console.log("[Semantic Search] Querying pgvector for matches...");
        const { data: matches } = await supabase.rpc('match_interactions', {
          query_embedding: queryEmbedding,
          match_account_id: account.id,
          match_count: 3
        });
        semanticMatches = matches || [];
        console.log(`[Semantic Search] Found ${semanticMatches.length} semantic matches!`);
      }

      // Filter out garbage names from existing DB data just in case
      const garbageWords = /\b(meeting|today|yesterday|tomorrow|discuss|follow|company|integration|at|the|a|visited|email|whatsapp)\b/i;
      const cleanContacts = (contacts || []).filter((c: any) => !garbageWords.test(c.name));

        return {
        found: true,
        account: { name: account.name, type: account.type, stage: account.stage, city: account.city },
        contacts: cleanContacts,
        interactions: cleanInteractions, 
        actionItems: actionItems || [],
        semanticMatches: semanticMatches 
      };
    },
  };

  const captureMeetingNotesTool = {
    description: 'Saves meeting notes and interactions to the CRM database. Use this ONLY when the user provides NEW information or describes a past event. Trigger words: "Met", "Attended", "Discussed", "Follow up", "Had a meeting". Do NOT use this if the user is just asking a question.',
    parameters: z.object({
      companyName: z.string().describe('The name of the company discussed. JUST the proper noun, e.g., "Kyndryl". NEVER include words like "with", "at", "met", or "visited" in this string.'),
      interactionType: z.string().describe('The type of interaction. Possible values: "meeting", "email", "whatsapp", "linkedin".'),
      interactionNotes: z.string().describe('A detailed summary of EVERYTHING discussed in the meeting. Never leave this blank. If the user says "Discussed regulatory compliance", write "Discussed regulatory compliance".'),
      contacts: z.array(z.object({
        name: z.string().describe('The FIRST and LAST name of a HUMAN PERSON. Do NOT put event descriptions, companies, or sentences here. Only proper names like "Sunder Pichai".'),
        title: z.string().optional().describe('Job title of the person, if mentioned.'),
      })).describe('Array of ALL people mentioned. NEVER include meeting details or companies in the name field.'),
      actionItems: z.array(z.object({
        description: z.string().describe('What needs to be done.'),
        priority: z.string().describe('Priority: "P1" (Urgent), "P2" (Next Week), "P3" (Delegate)'),
        dueDate: z.string().describe('Due date in YYYY-MM-DD format or relative like "Next week"').optional(),
      })).describe('Array of ALL follow-ups, tasks, or next steps mentioned.'),
    }),
    execute: async ({ companyName, interactionType, interactionNotes, contacts, actionItems }: { 
      companyName: string; 
      interactionType: string; 
      interactionNotes: string; 
      contacts: { name: string, title?: string }[]; 
      actionItems: { description: string, priority: string, dueDate?: string }[] 
    }): Promise<WriteToolResult> => {
      
      let finalCompanyName = companyName;
      let finalContacts: any[] = contacts || [];
      let finalActionItems: any[] = actionItems || [];
      let finalInteractionNotes = interactionNotes; 

      // Extract user message ONCE at the top for all fallbacks
      const lastUserMessage = coreMessages.filter((m: any) => m.role === 'user').pop()?.content || '';

      // ==========================================
      // CLEAN COMPANY NAME FIRST! (Crucial for contact filter)
      // ==========================================
      if (finalCompanyName) {
        finalCompanyName = finalCompanyName.replace(/^(met with|met|with|at|visited|about|for|of)\s+/i, '').trim();
      }

      // ==========================================
      // GARBAGE FILTER & COMPANY FILTER (NUCLEAR OPTION)
      // ==========================================
      const garbageWords = /\b(meeting|today|yesterday|tomorrow|discuss|follow|company|integration|at|the|a|visited|email|whatsapp|met|with|about|for|of)\b/i;
      
      // 1. Filter garbage words
      finalContacts = finalContacts.filter(c => !garbageWords.test(c.name));

      // 2. Strip leading prepositions (e.g. "with Kyndryl" -> "Kyndryl")
      finalContacts = finalContacts.map(c => ({
        ...c,
        name: c.name.replace(/^(met with|met|with|at|visited|about|for|of)\s+/i, '').trim()
      }));

      // 3. NUCLEAR: If the contact name matches the company name (exactly or contains it), REMOVE IT.
      if (finalCompanyName && finalCompanyName.trim() !== '') {
        finalContacts = finalContacts.filter(c => {
          const contactLower = c.name.toLowerCase();
          const companyLower = finalCompanyName.toLowerCase();
          return contactLower !== companyLower && !contactLower.includes(companyLower);
        });
      }

      // NEW: If the AI forgot the interaction notes, use the user's original message!
      if (!finalInteractionNotes || finalInteractionNotes.trim() === '') {
        console.log("[Write Fallback] AI forgot interaction notes. Using user message.");
        finalInteractionNotes = lastUserMessage; 
      }

      // UPGRADED: If AI forgets, or passes lazy text starting with "with" or "met", force proper extraction
      if (!finalCompanyName || finalCompanyName.trim() === '' || /^(met with|met|with|at|visited|about|for|of)\b/i.test(finalCompanyName)) {
        console.log("[Write Fallback] AI didn't extract the company name properly. Extracting manually...");
        const match = lastUserMessage.match(/\b(?:met with|met|at|visited|of|about|for)\s+([A-Z][a-z0-9&]+(?:\s[A-Z][a-z0-9&]+)*)/i);
        if (match && match[1]) {
          finalCompanyName = match[1].trim();
        } else {
          return { success: false, message: "I understood the meeting notes, but I couldn't figure out which company you met with. Could you please specify the company name?" };
        }
      }

      if (!finalContacts || finalContacts.length === 0) {
        const contactMatches = lastUserMessage.match(/(?:met with|met|attended|joined|was there)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/gi);
        if (contactMatches) {
          let extractedContacts = contactMatches.map((c: string) => ({ name: c.replace(/^(met with|met|attended|joined|was there)\s+/i, '').trim() }));
          finalContacts = extractedContacts.filter((c: { name: string }) => !garbageWords.test(c.name));
          
          // NUCLEAR: Filter company name from regex extraction too!
          if (finalCompanyName) {
             finalContacts = finalContacts.filter(c => c.name.toLowerCase() !== finalCompanyName.toLowerCase());
          }
        }
      }

      if (!finalActionItems || finalActionItems.length === 0) {
        const actionMatch = lastUserMessage.match(/(follow up on .*?|action: .*?|todo: .*?)(?:\.|$)/gi);
        if (actionMatch) {
          finalActionItems = actionMatch.map((a: string) => ({ description: a.trim(), priority: 'P2', dueDate: undefined }));
        }
      } 
      
      if (finalActionItems && finalActionItems.length > 0) {
        const firstItem = finalActionItems[0];
        if (!firstItem.dueDate || firstItem.dueDate.trim() === '') {              
          if (/\btomorrow\b/i.test(lastUserMessage)) {
            const d = new Date(); d.setDate(d.getDate() + 1); firstItem.dueDate = d.toISOString().split('T')[0];
          } else if (/\btoday\b/i.test(lastUserMessage)) {
            firstItem.dueDate = new Date().toISOString().split('T')[0];
          } else {
            const dateMatch = lastUserMessage.match(/(?:by|before|on)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?)/i);
            if (dateMatch && dateMatch[1]) {
              const currentYear = new Date().getFullYear();
              const monthMap: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
              const month = monthMap[dateMatch[1].toLowerCase().substring(0, 3)];
              const day = dateMatch[1].match(/\d{1,2}/)?.[0].padStart(2, '0');
              if (month && day) firstItem.dueDate = `${currentYear}-${month}-${day}`;
            } else if (/\bnext week\b/i.test(lastUserMessage)) {
              const d = new Date(); d.setDate(d.getDate() + 7); firstItem.dueDate = d.toISOString().split('T')[0];
            }
          }
        }
      }

      if (finalActionItems && finalActionItems.length > 0) {
        const currentYear = new Date().getFullYear();
        const monthMap: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
        finalActionItems = finalActionItems.map(item => {
          let formattedDate = item.dueDate || null;
          let cleanDescription = item.description;
          if (formattedDate) {
            const dateMatch = formattedDate.match(/([A-Za-z]+)\s+(\d{1,2})/);
            if (dateMatch) {
              const month = monthMap[dateMatch[1].toLowerCase().substring(0, 3)];
              const day = dateMatch[2].padStart(2, '0');
              if (month && day) formattedDate = `${currentYear}-${month}-${day}`;
            } else if (formattedDate.toLowerCase().includes('next week')) {
              const d = new Date(); d.setDate(d.getDate() + 7); formattedDate = d.toISOString().split('T')[0];
            }
          }
          if (cleanDescription) {
            cleanDescription = cleanDescription
              .replace(/\s*by\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?/i, '')
              .replace(/\s*by\s+(next week|tomorrow|today)/i, '')
              .trim();
          }
          return { ...item, dueDate: formattedDate, description: cleanDescription || item.description };
        });
      }
          
      const supabase = await createServerClientInstance();
      const { data: account } = await supabase.from('accounts').select('id').ilike('name', `%${finalCompanyName}%`).limit(1).single();
      let accountId = account?.id;

      if (!accountId) {
        const { data: newAccount, error: accError } = await supabase.from('accounts').insert([{ name: finalCompanyName, stage: 'Cold' }]).select('id').single();
        if (accError) return { success: false, message: `Error creating account: ${accError.message}` };
        accountId = newAccount.id;
      }

      // ==========================================
      // 2. Create Interaction AND Auto-Embed (WITH JS DEDUPE)
      // ==========================================
      let newInteraction: any = null;
      
            // JS Deduplication: Check if a very similar note already exists (ignoring punctuation & casing)
      const { data: existingInteractions } = await supabase.from('interactions').select('notes').eq('account_id', accountId);
      const cleanNewNote = finalInteractionNotes.replace(/[^a-zA-Z0-9 ]/g, '').toLowerCase().replace(/bridgi ai/gi, '').trim();
      
      const isDuplicate = existingInteractions?.some((i: any) => {
        const cleanExistingNote = (i.notes || '').replace(/[^a-zA-Z0-9 ]/g, '').toLowerCase().replace(/bridgi ai/gi, '').trim();
        return cleanExistingNote === cleanNewNote;
      });

      if (!isDuplicate) {
        const { data } = await supabase
          .from('interactions')
          .insert([{
            account_id: accountId,
            type: interactionType,
            notes: finalInteractionNotes,
          }])
          .select('id')
          .single();
        newInteraction = data;

        // Generate the vector embedding
        if (newInteraction) {
          console.log("[Embedding] Generating vector for interaction...");
          const embedding = await generateEmbedding(finalInteractionNotes);
          
          if (embedding) {
            await supabase.from('interactions').update({ embedding: embedding }).eq('id', newInteraction.id);
            console.log("[Embedding] Vector saved to database!");
            // Update the account's last_activity_at timestamp
            await supabase
              .from('accounts')
              .update({ last_activity_at: new Date().toISOString().split('T')[0] })
              .eq('id', accountId);
          }
        }
      } else {
        console.log("[Write Dedupe] Interaction already exists. Skipping insert.");
      }

      // 3. Create Contacts - WITH DEDUPE & CLEANUP
      if (finalContacts && finalContacts.length > 0) {
        const { data: existingContacts } = await supabase.from('contacts').select('name').eq('account_id', accountId);
        const existingNames = new Set(existingContacts?.map((c: any) => c.name.toLowerCase()) || []);

        const contactsToInsert = finalContacts
          .filter(c => !existingNames.has(c.name.toLowerCase()))
          .map(c => ({ account_id: accountId, name: c.name, title: c.title || null }));

        if (contactsToInsert.length > 0) {
          await supabase.from('contacts').insert(contactsToInsert);
        }
      }

      // 4. Create Action Items - WITH DEDUPE
      if (finalActionItems && finalActionItems.length > 0) {
        const { data: existingActions } = await supabase.from('action_items').select('description').eq('account_id', accountId);
        const existingDescs = new Set(existingActions?.map((a: any) => a.description.toLowerCase().trim()) || []);

        const itemsToInsert = finalActionItems
          .filter(a => !existingDescs.has(a.description.toLowerCase().trim()))
          .map(a => ({ account_id: accountId, description: a.description, priority: a.priority, due_date: a.dueDate || null, status: 'open' }));

        if (itemsToInsert.length > 0) {
          await supabase.from('action_items').insert(itemsToInsert);
        }
      }

      return { 
        success: true, 
        message: `Captured ${finalCompanyName}, ${finalContacts?.map(c => c.name).join(', ') || 'no new contacts'}, follow-up ${finalActionItems?.[0]?.dueDate || 'N/A'}` 
      };
    },
  };

    const getDailyDigestTool = {
    description: 'Fetches the daily digest for the user. Use this ONLY when the user asks "What is on my plate?", "What are my tasks today?", or "Daily digest".',
    parameters: z.object({}), // No parameters needed from AI
    execute: async (): Promise<DigestToolResult> => {
      console.log("[Digest Pipeline] Checking Redis cache...");
      const supabase = await createServerClientInstance();
      
      // 1. CHECK REDIS CACHE FIRST
      const cacheKey = `daily-digest-${new Date().toISOString().split('T')[0]}`;
      const cachedData = await redis.get(cacheKey);
      
      if (cachedData) {
        console.log("[Digest Pipeline] Cache HIT! Returning cached digest data.");
        return cachedData as DigestToolResult;
      }

      console.log("[Digest Pipeline] Cache MISS. Querying Supabase...");
      
      // 2. FETCH FROM SUPABASE
      const today = new Date().toISOString().split('T')[0];
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Fetch overdue and due-today action items
      const { data: overdueActions } = await supabase
        .from('action_items')
        .select('description, priority, due_date, status, accounts(name)')
        .eq('status', 'open')
        .lte('due_date', today);

      // Fetch stale accounts (no activity in 14 days)
      const { data: staleAccounts } = await supabase
        .from('accounts')
        .select('name, stage, last_activity_at')
        .lt('last_activity_at', twoWeeksAgo)
        .neq('stage', 'Closed Won'); // Ignore closed accounts

      const digestData = {
        overdueActions: overdueActions || [],
        staleAccounts: staleAccounts || []
      };

      // 3. SAVE TO REDIS CACHE (Expires in 1 hour / 3600 seconds)
      await redis.set(cacheKey, digestData, { ex: 3600 });
      console.log("[Digest Pipeline] Data cached for 1 hour.");

      return digestData;
    },
  };

  // ==========================================
  // AGENTIC RAG PIPELINE 
  // ==========================================
  const result = await streamText({
    model: google('gemini-2.5-flash'), 
    system: `You are Bridgi AI, the intelligent CRM assistant for Narayan S Mahadevan, Founder & CEO of BridgeLabz.
    You are warm, professional, and concise.
    Always address the user as Narayan.
       
    RULES FOR INTENT DETECTION:
    - If the user provides meeting notes, describes an interaction, or says words like "Met", "Attended", "Discussed", or "Follow up", you MUST use the captureMeetingNotes tool. This saves the data to the database.
    - If the user asks a QUESTION about a company (e.g., "What is the status of X?", "Who are the contacts at Y?", "What are the action items?"), you MUST use the getAccountInfo tool.
    - Do NOT use getAccountInfo if the user is giving you meeting notes! captureMeetingNotes is for SAVING data, getAccountInfo is for READING data.
    
    - DIGEST RULES: When the getDailyDigest tool returns data, you MUST present it clearly as a Daily Digest.
    - First, list the Overdue Action Items, grouping them by Priority (P1 first, then P2, then P3). Mention which company the action item belongs to.
    - Second, list the Stale Accounts (no activity in 14+ days) and suggest the user reach out to them.
    - If there are no overdue items or stale accounts, congratulate the user on being caught up!

    RULES FOR RENDERING:
    - After the tool returns data, you MUST present it clearly.
    - If the context contains Action Items, list them clearly with their Priority, Status, and Due Date.
    - NEVER skip the contacts list or action items if they are provided by the tool.
    - CRITICAL: When the captureMeetingNotes tool returns a success message, you MUST output EXACTLY that message and nothing else. Do not add your own summary or mention names that the tool did not confirm.
    // - CRITICAL: When the getAccountInfo tool returns data, DO NOT list out the contacts and action items in your text response. Just say a brief sentence like "Here is the information for [Company]:" or "Here are the action items for [Company]:". The UI will render the data card automatically.
    - SEMANTIC SEARCH: If the context includes "semanticMatches", these are past meeting notes found via semantic similarity (meaning-based search). Prioritize them to answer specific questions about what was discussed in the past, even if the exact keywords aren't in the user's question.`,
    
    messages: coreMessages,
    tools: {
      getAccountInfo: getAccountInfoTool as any,
      captureMeetingNotes: captureMeetingNotesTool as any,
      getDailyDigest: getDailyDigestTool as any,
    },
    
    toolChoice,
    // maxSteps: 5,
    
  });

  return result.toUIMessageStreamResponse();
}