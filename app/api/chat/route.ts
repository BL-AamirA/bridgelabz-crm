import { google } from '@ai-sdk/google';
import { generateEmbedding } from '@/lib/embeddings';
// import { streamText } from 'ai';
import { z } from 'zod';
import { createServerClientInstance } from '@/lib/supabase-server';
import { redis } from '@/lib/redis';  
import { streamText, generateText } from 'ai';

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
  semanticMatches?: any[];
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

type DraftToolResult = {
  error?: string;
  found?: boolean;
  message?: string;
  contact?: any;
  account?: any;
  recentInteractions?: any[];
  channel?: string;
  objective?: string;  
  draftText?: string;
};

type ProposeActionToolResult = {
  actionType: string;
  targetAccount: string;
  newValue: string;
  confirmationMessage: string;
};

type ExecuteActionToolResult = {
  success: boolean;
  message: string;
};

type TeamPlateToolResult = {
  error?: string;
  teamMember?: string;
  tasks?: any[];
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

  const lastUserMessage = coreMessages
    .filter((m: any) => m.role === 'user')
    .pop()?.content || '';

  // ==========================================
  // DETERMINISTIC ROUTING (Order Matters!)
  // ==========================================
  const isExecutionConfirmation = /\b(confirmed: execute)\b/i.test(lastUserMessage);
  const isNotes = /\b(met|attended|discussed|follow up|had a meeting|called|visited)\b/i.test(lastUserMessage) && !isExecutionConfirmation;
  const isNewProposal = !isExecutionConfirmation && !isNotes && (/\b(assign|update|change|set)\b/i.test(lastUserMessage) && /\b(spoc|owner|stage|assign)\b/i.test(lastUserMessage));
  const isTeamPlate = /\b(piyush|jomy|puneet|manoj|narayan)\b/i.test(lastUserMessage) && /\b(tasks|action items|plate|to-do)\b/i.test(lastUserMessage);
  const isDraft = /\b(draft|write|compose|create)\b/i.test(lastUserMessage) && /\b(email|whatsapp|message|linkedin)\b/i.test(lastUserMessage);
  const isDigest = /\b(plate|digest|today|tasks|todo)\b/i.test(lastUserMessage) && /\b(what|my|give|show)\b/i.test(lastUserMessage);
  const isQuestion = /\?$/.test(lastUserMessage.trim()) || /^(what|who|how|show|list|status|are|is)\b/i.test(lastUserMessage);

  let toolChoice: any = 'auto';
  if (isExecutionConfirmation) {
    console.log("[Router] Detected Execution Confirmation -> Forcing executeAction tool");
    toolChoice = { type: 'tool', toolName: 'executeAction' };
  } else if (isNewProposal) {
    console.log("[Router] Detected New Action Proposal -> Forcing proposeAction tool");
    toolChoice = { type: 'tool', toolName: 'proposeAction' };
  } else if (isTeamPlate) {
    console.log("[Router] Detected Team Plate Request -> Forcing getTeamPlate tool");
    toolChoice = { type: 'tool', toolName: 'getTeamPlate' };
  } else if (isDraft) {
    console.log("[Router] Detected Draft Request -> Forcing draftCommunication tool");
    toolChoice = { type: 'tool', toolName: 'draftCommunication' };
  } else if (isDigest) {
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
  // TOOL DEFINITIONS
  // ==========================================
  const getAccountInfoTool = {
    description: 'Fetches existing account details, contacts, interactions, and action items from the CRM database. Use this ONLY when the user asks a QUESTION about a specific company.',
    parameters: z.object({
      companyName: z.string().describe('The exact name of the company the user is asking about.'),
      focus: z.string().describe('What specific information the user is asking about.'),
    }),
    execute: async ({ companyName, focus }: { companyName: string; focus: string }): Promise<ReadToolResult> => {
      if (!companyName || companyName.trim() === '') {
        let lastUserMessage = coreMessages.filter((m: any) => m.role === 'user').pop()?.content || '';
        lastUserMessage = lastUserMessage.replace(/"/g, '');
        let match = lastUserMessage.match(/\b(?:at|for|of|with|about)\s+([A-Z][a-z0-9&]+(?:\s[A-Z][a-z0-9&]+)*)/);
        if (match && match[1]) {
          companyName = match[1].trim();
        } else {
          const lastWordMatch = lastUserMessage.match(/([A-Z][a-z0-9&]+(?:\s[A-Z][a-z0-9&]+)*)\s*\?/);
          if (lastWordMatch && lastWordMatch[1]) companyName = lastWordMatch[1].trim();
          else return { error: "No company name was provided." };
        }
      }

      const supabase = await createServerClientInstance();
      const { data: account } = await supabase.from('accounts').select('*').ilike('name', `%${companyName}%`).limit(1).single();
      if (!account) return { found: false, message: `Account "${companyName}" not found.` };

      const { data: contacts } = await supabase.from('contacts').select('name, title, email').eq('account_id', account.id);
      const { data: interactions } = await supabase.from('interactions').select('type, notes, date').eq('account_id', account.id).order('date', { ascending: false }).limit(3);
      const cleanInteractions = (interactions || []).filter((int: any) => int.notes && int.notes.trim() !== '');      
      const { data: actionItems } = await supabase.from('action_items').select('description, priority, due_date, status').eq('account_id', account.id).order('due_date', { ascending: true });
      
      let semanticMatches: any[] = [];
      const queryEmbedding = await generateEmbedding(lastUserMessage);
      if (queryEmbedding) {
        const { data: matches } = await supabase.rpc('match_interactions', { query_embedding: queryEmbedding, match_account_id: account.id, match_count: 3 });
        semanticMatches = matches || [];
      }

      const garbageWords = /\b(meeting|today|yesterday|tomorrow|discuss|follow|company|integration|at|the|a|visited|email|whatsapp)\b/i;
      const cleanContacts = (contacts || []).filter((c: any) => !garbageWords.test(c.name));

      return {
        found: true,
        account: { name: account.name, type: account.type, stage: account.stage, city: account.city },
        contacts: cleanContacts,
        interactions: cleanInteractions, 
        actionItems: actionItems || [],
        semanticMatches 
      };
    },
  };

  const captureMeetingNotesTool = {
    description: 'Saves meeting notes and interactions to the CRM database. Use this ONLY when the user provides NEW information.',
    parameters: z.object({
      companyName: z.string().describe('The name of the company discussed.'),
      interactionType: z.string().describe('The type of interaction.'),
      interactionNotes: z.string().describe('A detailed summary of EVERYTHING discussed.'),
      contacts: z.array(z.object({
        name: z.string().describe('The FIRST and LAST name of a HUMAN PERSON.'),
        title: z.string().optional(),
      })).describe('Array of ALL people mentioned.'),
      actionItems: z.array(z.object({
        description: z.string().describe('What needs to be done.'),
        priority: z.string().describe('Priority: P1, P2, P3'),
        dueDate: z.string().optional(),
        assignedTo: z.string().optional(),
      })).describe('Array of ALL follow-ups, tasks, or next steps mentioned.'),
    }),
    execute: async ({ companyName, interactionType, interactionNotes, contacts, actionItems }: { 
      companyName: string; 
      interactionType: string; 
      interactionNotes: string; 
      contacts: { name: string, title?: string }[]; 
      actionItems: { description: string, priority: string, dueDate?: string, assignedTo?: string }[] 
    }): Promise<WriteToolResult> => {
      
      let finalCompanyName = companyName;
      let finalContacts: any[] = contacts || [];
      let finalActionItems: any[] = actionItems || [];
      let finalInteractionNotes = interactionNotes; 

      const lastUserMessage = coreMessages.filter((m: any) => m.role === 'user').pop()?.content || '';

      // ==========================================
      // 1. CLEANUP: COMPANY & CONTACTS
      // ==========================================
      if (finalCompanyName) {
        finalCompanyName = finalCompanyName.replace(/^(met with|met|with|at|visited|about|for|of)\s+/i, '').trim();
      }

      const garbageWords = /\b(meeting|today|yesterday|tomorrow|discuss|follow|company|integration|at|the|a|visited|email|whatsapp|met|with|about|for|of)\b/i;
      finalContacts = finalContacts.filter(c => !garbageWords.test(c.name));
      finalContacts = finalContacts.map(c => ({ ...c, name: c.name.replace(/^(met with|met|with|at|visited|about|for|of)\s+/i, '').trim() }));

      if (finalCompanyName && finalCompanyName.trim() !== '') {
        finalContacts = finalContacts.filter(c => c.name.toLowerCase() !== finalCompanyName.toLowerCase());
      }

      if (!finalInteractionNotes || finalInteractionNotes.trim() === '') {
        finalInteractionNotes = lastUserMessage; 
      }

      if (!finalCompanyName || finalCompanyName.trim() === '' || /^(met with|met|with|at|visited|about|for|of)\b/i.test(finalCompanyName)) {
        const match = lastUserMessage.match(/\b(?:met with|met|at|visited|of|about|for)\s+([A-Z][a-z0-9&]+(?:\s[A-Z][a-z0-9&]+)*)/i);
        if (match && match[1]) finalCompanyName = match[1].trim();
        else return { success: false, message: "Couldn't figure out which company you met with." };
      }

      if (!finalContacts || finalContacts.length === 0) {
        const contactMatches = lastUserMessage.match(/(?:met with|met|attended|joined|was there)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/gi);
        if (contactMatches) {
          let extractedContacts = contactMatches.map((c: string) => ({ name: c.replace(/^(met with|met|attended|joined|was there)\s+/i, '').trim() }));
          finalContacts = extractedContacts.filter((c: { name: string }) => !garbageWords.test(c.name));
          if (finalCompanyName) finalContacts = finalContacts.filter(c => c.name.toLowerCase() !== finalCompanyName.toLowerCase());
        }
      }

      // ==========================================
      // 2. DETERMINISTIC ACTION ITEM PARSER (Expert Mode)
      // ==========================================
      let parsedDueDate: string | null = null;
      let parsedAssignee = 'Narayan';
      
      // A. Parse Assignee strictly
      const assignMatch = lastUserMessage.match(/\bassign(?:ed)?\s+to\s+([A-Za-z]+)/i);
      if (assignMatch && assignMatch[1]) {
        parsedAssignee = assignMatch[1].trim();
      }

      // B. Parse Due Date strictly
      if (/\btomorrow\b/i.test(lastUserMessage)) {
        const d = new Date(); d.setDate(d.getDate() + 1); parsedDueDate = d.toISOString().split('T')[0];
      } else if (/\btoday\b/i.test(lastUserMessage)) {
        parsedDueDate = new Date().toISOString().split('T')[0];
      } else if (/\bnext week\b/i.test(lastUserMessage)) {
        const d = new Date(); d.setDate(d.getDate() + 7); parsedDueDate = d.toISOString().split('T')[0];
      } else {
        const dateMatch = lastUserMessage.match(/(?:by|before|on)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?)/i);
        if (dateMatch && dateMatch[1]) {
          const currentYear = new Date().getFullYear();
          const monthMap: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
          const month = monthMap[dateMatch[1].toLowerCase().substring(0, 3)];
          const day = dateMatch[1].match(/\d{1,2}/)?.[0].padStart(2, '0');
          if (month && day) parsedDueDate = `${currentYear}-${month}-${day}`;
        }
      }

      // C. Parse Action Items if AI got lazy and returned nothing
      if (!finalActionItems || finalActionItems.length === 0) {
        console.log("[Write Fallback] AI didn't return action items. Force extracting...");
        // Look for common action verbs
        const actionMatch = lastUserMessage.match(/\b(?:follow up on|send|prepare|draft|schedule|complete|review|call|email|share|update|set up|fix|write|create)\b\s+([A-Za-z0-9\s]+?)(?=\s+by\s+|\s+assign\b|\.\s*|$)/i);
        if (actionMatch && actionMatch[0]) {
          finalActionItems = [{ 
            description: actionMatch[0].trim(), 
            priority: 'P2', 
            dueDate: parsedDueDate || undefined, 
            assignedTo: parsedAssignee 
          }];
        }
      }

      // D. FORCE OVERRIDE: Inject parsed data into whatever items we have
      if (finalActionItems && finalActionItems.length > 0) {
        finalActionItems = finalActionItems.map(item => {
          let cleanDescription = item.description;
          if (cleanDescription) {
            cleanDescription = cleanDescription
              .replace(/\s*by\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?/i, '')
              .replace(/\s*by\s+(next week|tomorrow|today)/i, '')
              .replace(/\s*assign(?:ed)?\s+to\s+[A-Za-z]+/i, '')
              .trim();
          }
          return {
            ...item,
            description: cleanDescription || item.description,
            dueDate: parsedDueDate || item.dueDate || null, // Force override date
            assignedTo: parsedAssignee // Force override assignee
          };
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
      // 3. SAVE INTERACTION & EMBED
      // ==========================================
      let newInteraction: any = null;
      const { data: existingInteractions } = await supabase.from('interactions').select('notes').eq('account_id', accountId);
      const cleanNewNote = finalInteractionNotes.replace(/[^a-zA-Z0-9 ]/g, '').toLowerCase().replace(/bridgi ai/gi, '').trim();
      
      const isDuplicate = existingInteractions?.some((i: any) => {
        const cleanExistingNote = (i.notes || '').replace(/[^a-zA-Z0-9 ]/g, '').toLowerCase().replace(/bridgi ai/gi, '').trim();
        return cleanExistingNote === cleanNewNote;
      });

      if (!isDuplicate) {
        const { data } = await supabase
          .from('interactions')
          .insert([{ account_id: accountId, type: interactionType, notes: finalInteractionNotes }])
          .select('id')
          .single();
        newInteraction = data;

        if (newInteraction) {
          console.log("[Embedding] Generating vector for interaction...");
          const embedding = await generateEmbedding(finalInteractionNotes);
          if (embedding) {
            await supabase.from('interactions').update({ embedding: embedding }).eq('id', newInteraction.id);
            await supabase.from('accounts').update({ last_activity_at: new Date().toISOString().split('T')[0] }).eq('id', accountId);
          }
        }
      } else {
        console.log("[Write Dedupe] Interaction already exists. Skipping insert.");
      }

      // ==========================================
      // 4. SAVE CONTACTS
      // ==========================================
      if (finalContacts && finalContacts.length > 0) {
        const { data: existingContacts } = await supabase.from('contacts').select('name').eq('account_id', accountId);
        const existingNames = new Set(existingContacts?.map((c: any) => c.name.toLowerCase()) || []);
        const contactsToInsert = finalContacts
          .filter(c => !existingNames.has(c.name.toLowerCase()))
          .map(c => ({ account_id: accountId, name: c.name, title: c.title || null }));
        if (contactsToInsert.length > 0) await supabase.from('contacts').insert(contactsToInsert);
      }

      // ==========================================
      // 5. SAVE ACTION ITEMS
      // ==========================================
      if (finalActionItems && finalActionItems.length > 0) {
        const { data: existingActions } = await supabase.from('action_items').select('description').eq('account_id', accountId);
        const existingDescs = new Set(existingActions?.map((a: any) => a.description.toLowerCase().trim()) || []);
        const itemsToInsert = finalActionItems
          .filter(a => !existingDescs.has(a.description.toLowerCase().trim()))
          .map(a => ({ account_id: accountId, description: a.description, priority: a.priority, due_date: a.dueDate || null, assigned_to: a.assignedTo || 'Narayan', status: 'open' }));
        if (itemsToInsert.length > 0) await supabase.from('action_items').insert(itemsToInsert);
      }

      const assignedToName = finalActionItems?.[0]?.assignedTo || 'Narayan';
      return { 
        success: true, 
        message: `Captured ${finalCompanyName}, ${finalContacts?.map(c => c.name).join(', ') || 'no new contacts'}, follow-up ${finalActionItems?.[0]?.dueDate || 'N/A'} (Assigned to ${assignedToName})` 
      };
    },
  };

  const draftCommunicationTool = {
    description: 'Fetches context to draft a communication (email, whatsapp, linkedin).',
    parameters: z.object({
      contactName: z.string(),
      channel: z.string(),
      objective: z.string().optional(),
    }),
    execute: async ({ contactName, channel, objective }: { contactName: string; channel: string; objective?: string }): Promise<DraftToolResult> => {
      let finalContactName = contactName;
      let finalChannel = channel;
      let finalObjective = objective;
      const lastUserMessage = coreMessages.filter((m: any) => m.role === 'user').pop()?.content || '';

      if (!finalContactName || finalContactName.trim() === '' || finalContactName === 'undefined') {
        const match = lastUserMessage.match(/\b(?:to|for)\s+([A-Za-z]+(?:\s[A-Za-z]+)*)\s+(?:at|about|regarding)/i);
        if (match && match[1]) finalContactName = match[1].trim();
        else return { found: false, message: "Who would you like to draft this message to?" };
      }
      if (!finalChannel || finalChannel.trim() === '' || finalChannel === 'undefined') {
        if (/whatsapp/i.test(lastUserMessage)) finalChannel = 'whatsapp';
        else if (/email/i.test(lastUserMessage)) finalChannel = 'email';
        else if (/linkedin/i.test(lastUserMessage)) finalChannel = 'linkedin';
        else finalChannel = 'email'; 
      }
      if (!finalObjective || finalObjective.trim() === '' || finalObjective === 'undefined') finalObjective = lastUserMessage; 
      if (finalContactName) finalContactName = finalContactName.replace(/\s+(at|about|regarding|from|for)\s+.*$/i, '').trim();

      const supabase = await createServerClientInstance();
      const { data: contact } = await supabase.from('contacts').select('*, accounts(*)').ilike('name', `%${finalContactName}%`).limit(1).single();
      if (!contact) return { found: false, message: `Contact "${finalContactName}" not found.` };

      const { data: interactions } = await supabase.from('interactions').select('type, notes, date').eq('account_id', contact.account_id).order('date', { ascending: false }).limit(3);

      let toneInstruction = "";
      let fewShotExample = "";
      if (finalChannel === 'whatsapp') {
        toneInstruction = "Write a short, warm, informal WhatsApp message. Use emojis. End with '- Narayan'.";
        fewShotExample = `Hi Praveen 👋 Great meeting you today! Just sharing the deck we discussed 🚀 - Narayan`;
      } else if (finalChannel === 'email') {
        toneInstruction = "Write a professional, formal email. Start with 'Dear [Name]', end with 'Best regards, Narayan'. Include a subject line.";
        fewShotExample = `Subject: Follow up\n\nDear Praveen,\n\nIt was a pleasure meeting you.\n\nBest regards,\nNarayan`;
      } else {
        toneInstruction = "Write a professional but conversational LinkedIn message.";
      }

      const interactionsContext = (interactions || []).map((int: any) => `- (${int.date}) ${int.notes}`).join('\n');
      const { text: draftText } = await generateText({
        model: google('gemini-2.5-flash'),
        prompt: `You are Bridgi AI, the CRM assistant for Narayan S Mahadevan.
        Objective: ${finalObjective}
        Contact Name: ${contact.name} (${contact.title || 'No title'})
        Company: ${contact.accounts?.name || 'Unknown'}
        Recent Meeting Notes:\n${interactionsContext}\n\n${toneInstruction}\n${fewShotExample}\n\nWrite the message now:`
      });

      return { found: true, contact: { name: contact.name, title: contact.title, email: contact.email }, account: { name: contact.accounts?.name }, channel: finalChannel, draftText };
    },
  };

  const getDailyDigestTool = {
    description: 'Fetches the daily digest for the user.',
    parameters: z.object({}),
    execute: async (): Promise<DigestToolResult> => {
      const supabase = await createServerClientInstance();
      const cacheKey = `daily-digest-${new Date().toISOString().split('T')[0]}`;
      const cachedData = await redis.get(cacheKey);
      if (cachedData) return cachedData as DigestToolResult;

      const today = new Date().toISOString().split('T')[0];
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { data: overdueActions } = await supabase.from('action_items').select('description, priority, due_date, status, accounts(name)').eq('status', 'open').lte('due_date', today);
      const { data: staleAccounts } = await supabase.from('accounts').select('name, stage, last_activity_at').lt('last_activity_at', twoWeeksAgo).neq('stage', 'Closed Won');

      const digestData = { overdueActions: overdueActions || [], staleAccounts: staleAccounts || [] };
      await redis.set(cacheKey, digestData, { ex: 3600 });
      return digestData;
    },
  };

  const proposeActionTool = {
    description: 'Use this when the user wants to assign an account, change a stage, or update a record.',
    parameters: z.object({
      actionType: z.string(),
      targetAccount: z.string(),
      newValue: z.string(),
    }),
    execute: async ({ actionType, targetAccount, newValue }: { actionType: string; targetAccount: string; newValue: string }): Promise<ProposeActionToolResult> => {
      let finalActionType = actionType;
      let finalTargetAccount = targetAccount;
      let finalNewValue = newValue;
      const lastUserMessage = coreMessages.filter((m: any) => m.role === 'user').pop()?.content || '';

      if (!finalActionType || finalActionType === 'undefined') {
        if (/\bassign\b/i.test(lastUserMessage)) finalActionType = 'assign_spoc';
        else if (/\bstage\b/i.test(lastUserMessage)) finalActionType = 'update_stage';
        else finalActionType = 'update';
      }
      if (!finalTargetAccount || finalTargetAccount === 'undefined') {
        const assignMatch = lastUserMessage.match(/(?:assign|update|change)\s+([A-Za-z0-9& ]+?)\s+(?:to|stage)/i);
        if (assignMatch && assignMatch[1]) finalTargetAccount = assignMatch[1].trim();
      }
      if (!finalNewValue || finalNewValue === 'undefined') {
        const valueMatch = lastUserMessage.match(/(?:to|stage)\s+([A-Za-z0-9& ]+?)(?:\.|!|$)/i);
        if (valueMatch && valueMatch[1]) finalNewValue = valueMatch[1].trim();
      }

      let confirmationMessage = "";
      if (finalActionType === 'assign_spoc') confirmationMessage = `Are you sure you want to assign **${finalTargetAccount}** to **${finalNewValue}**?`;
      else if (finalActionType === 'update_stage') confirmationMessage = `Are you sure you want to change the stage of **${finalTargetAccount}** to **${finalNewValue}**?`;
      else confirmationMessage = `Are you sure you want to update **${finalTargetAccount}** to **${finalNewValue}**?`;

      return { actionType: finalActionType, targetAccount: finalTargetAccount, newValue: finalNewValue, confirmationMessage };
    },
  };

  const executeActionTool = {
    description: 'Executes a previously proposed action after the user confirms it.',
    parameters: z.object({ actionType: z.string(), targetAccount: z.string(), newValue: z.string() }),
    execute: async ({ actionType, targetAccount, newValue }: { actionType: string; targetAccount: string; newValue: string }): Promise<ExecuteActionToolResult> => {
      let finalActionType = actionType;
      let finalTargetAccount = targetAccount;
      let finalNewValue = newValue;
      const lastUserMessage = coreMessages.filter((m: any) => m.role === 'user').pop()?.content || '';

      if (!finalActionType || finalActionType === 'undefined' || !finalTargetAccount || finalTargetAccount === 'undefined' || !finalNewValue || finalNewValue === 'undefined') {
        const match = lastUserMessage.match(/^Confirmed: Execute (.+?) on (.+?) with value (.+?)$/i);
        if (match && match[1] && match[2] && match[3]) {
          finalActionType = match[1].trim(); finalTargetAccount = match[2].trim(); finalNewValue = match[3].trim();
        } else return { success: false, message: "Could not understand the confirmation." };
      }

      const supabase = await createServerClientInstance();
      let updatePayload: any = {};
      if (finalActionType === 'assign_spoc') updatePayload.spoc_name = finalNewValue;
      else if (finalActionType === 'update_stage') updatePayload.stage = finalNewValue;
      else updatePayload.spoc_name = finalNewValue;

      const { error } = await supabase.from('accounts').update(updatePayload).ilike('name', `%${finalTargetAccount}%`);
      if (error) return { success: false, message: `Error: ${error.message}` };
      
      let successMsg = `Successfully updated ${finalTargetAccount}.`;
      if (finalActionType === 'assign_spoc') successMsg += ` Assigned to ${finalNewValue}.`;
      else if (finalActionType === 'update_stage') successMsg += ` Stage changed to ${finalNewValue}.`;

      return { success: true, message: successMsg };
    },
  };

  const getTeamPlateTool = {
    description: 'Fetches action items assigned to a specific team member.',
    parameters: z.object({ teamMemberName: z.string().describe('The first name of the team member.') }),
    execute: async ({ teamMemberName }: { teamMemberName: string }): Promise<TeamPlateToolResult> => {
      let finalTeamMemberName = teamMemberName;
      const lastUserMessage = coreMessages.filter((m: any) => m.role === 'user').pop()?.content || '';

      if (!finalTeamMemberName || finalTeamMemberName.trim() === '' || finalTeamMemberName === 'undefined') {
        const knownMembers = ['piyush', 'jomy', 'puneet', 'manoj', 'narayan', 'anindo', 'vishy'];
        const foundMember = knownMembers.find(member => lastUserMessage.toLowerCase().includes(member));
        if (foundMember) finalTeamMemberName = foundMember.charAt(0).toUpperCase() + foundMember.slice(1);
        else return { error: "Which team member's plate would you like to see?" };
      }

      const supabase = await createServerClientInstance();
      const { data: tasks } = await supabase.from('action_items').select('description, priority, due_date, status, accounts(name)').ilike('assigned_to', `%${finalTeamMemberName}%`).eq('status', 'open');
      return { teamMember: finalTeamMemberName, tasks: tasks || [] };
    },
  };

  // ==========================================
  // AGENTIC RAG PIPELINE 
  // ==========================================
  const result = await streamText({
    model: google('gemini-2.5-flash'), 
    system: `You are Bridgi AI, the intelligent CRM assistant for Narayan S Mahadevan, Founder & CEO of BridgeLabz.
    You are warm, professional, and concise. Always address the user as Narayan.
       
    RULES FOR INTENT DETECTION:
    - If the user provides meeting notes, describes an interaction, or says words like "Met", "Attended", "Discussed", or "Follow up", you MUST use the captureMeetingNotes tool.
    - If the user asks a QUESTION about a company, you MUST use the getAccountInfo tool.
    
    RULES FOR RENDERING:
    - After the tool returns data, you MUST present it clearly.
    - CRITICAL: When the captureMeetingNotes tool returns a success message, you MUST output EXACTLY that message and nothing else.
    - SEMANTIC SEARCH: Prioritize vector matches to answer specific questions about what was discussed in the past.
    
    - DRAFTING RULES: Output the draft directly as your text response.
    - ACTION RULES: When the user says "Confirmed: Execute [actionType] on [targetAccount] with value [newValue]", you MUST use the executeAction tool.`,
    
    messages: coreMessages,
    tools: {
      getAccountInfo: getAccountInfoTool as any,
      captureMeetingNotes: captureMeetingNotesTool as any,
      getDailyDigest: getDailyDigestTool as any,
      draftCommunication: draftCommunicationTool as any,
      proposeAction: proposeActionTool as any,
      executeAction: executeActionTool as any,
      getTeamPlate: getTeamPlateTool as any,
    },
    
    toolChoice,
  });

  return result.toUIMessageStreamResponse();
}