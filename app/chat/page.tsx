"use client";

import { useChat } from '@ai-sdk/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BridgiLogo } from "@/components/BridgiLogo";

export default function Chat() {
  const router = useRouter();
  const { messages, sendMessage, status } = useChat();
  
  const [input, setInput] = useState("");
  const isLoading = status === 'submitted' || status === 'streaming';

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput("");
  };

  return (
    <main className="min-h-screen p-10 bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <BridgiLogo size={40} />
          <h1 className="text-3xl font-bold text-[#091C2B]">Bridgi AI</h1>
        </div>
        <button onClick={() => router.push("/")} className="text-[#D26A3E] hover:underline">
          ← Back to Dashboard
        </button>
      </div>

      {/* Chat Window */}
      <div className="flex-grow bg-white p-6 rounded-lg shadow-md border border-gray-200 mb-4 overflow-y-auto" style={{ minHeight: '400px', maxHeight: '60vh' }}>
        {messages.length === 0 ? (
          <div className="text-center mt-20 flex flex-col items-center gap-4">
            <BridgiLogo size={60} />
            <p className="text-gray-500 text-xl font-medium">Hi Narayan, I'm Bridgi AI. How can I help you today?</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
              {messages.map((m, messageIndex) => {
              // Track which tool results we've already rendered to prevent duplicates
              const renderedTools = new Set();
              
              return (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {/* AI Bubble */}
                {m.role !== 'user' && <div className="mr-2 mt-1"><BridgiLogo size={32} /></div>}
                <div className={`max-w-[70%] p-3 rounded-lg shadow-sm ${m.role === 'user' ? 'bg-[#091C2B] text-white' : 'bg-gray-100 text-black border'}`}>
                  <span className="text-xs font-semibold block mb-1 opacity-70">
                    {m.role === 'user' ? 'Narayan' : 'Bridgi AI'}
                  </span>
                  <div className="whitespace-pre-wrap">
                    {m.parts.map((part, i) => {
                      // 1. Render standard text
                      if (part.type === 'text') {
                        return <div key={i}>{part.text}</div>;
                      }
                      
                      // 2. Ignore step-starts
                      if (part.type === 'step-start') {
                        return null;
                      }

                      // 3. Handle Tool Calls
                      if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
                        const toolPart = part as any;
                        
                        // If the tool is currently running
                        if (toolPart.state === 'input-streaming' || toolPart.state === 'input-available') {
                          return (
                            <div key={i} className="text-sm text-gray-400 animate-pulse mb-1">
                              🔍 Processing...
                            </div>
                          );
                        }
                        
                        // If the tool finished                                         
                        if (toolPart.state === 'output-available') {
                          const data = toolPart.output;
                          // Safely extract tool name (removes 'tool-' prefix if it exists)
                          const toolName = part.type.replace('tool-', ''); 
                          
                          // DEDUPLICATION: Skip if we already rendered this tool
                          if (renderedTools.has(toolPart.toolCallId)) return null;
                          renderedTools.add(toolPart.toolCallId); 

                          // ==========================================
                          // RENDER WRITE CONFIRMATION (Meeting Notes)
                          // ==========================================
                          if (toolName === 'captureMeetingNotes') {
                            if (data.success) {
                              return (
                                <div key={i} className="mt-2 bg-green-50 border border-green-200 text-green-800 p-3 rounded text-sm flex items-start gap-2">
                                  <span className="text-lg">✅</span>
                                  <div>
                                    <div className="font-bold">Saved to CRM!</div>
                                    <div>{data.message}</div>
                                  </div>
                                </div>
                              );
                            } else {
                              return <div key={i} className="text-red-500 text-sm mt-1 bg-red-50 p-2 rounded border border-red-200">{JSON.stringify(data)}</div>;
                            }
                          }

                          // ==========================================
                          // RENDER DAILY DIGEST
                          // ==========================================
                          if (toolName === 'getDailyDigest') {
                            return (
                              <div key={i} className="mt-2 text-sm space-y-3 bg-blue-50 p-4 rounded border border-blue-100">
                                <div className="font-bold text-[#091C2B] text-base flex items-center gap-2">
                                  📋 Daily Digest
                                </div>

                                {/* Overdue Action Items */}
                                {data.overdueActions?.length > 0 ? (
                                  <div>
                                    <div className="font-semibold text-xs text-red-600 uppercase tracking-wider">Overdue / Due Today Action Items</div>
                                    <ul className="mt-1 space-y-1">
                                      {data.overdueActions.map((a: any, idx: number) => (
                                        <li key={idx} className="text-gray-800">
                                          <span className="font-medium">{a.priority}</span> {a.description} 
                                          <span className="text-gray-500 text-xs ml-1">({a.accounts?.name || 'Unknown Company'} - Due: {a.due_date || 'N/A'})</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : (
                                  <div className="text-green-700 italic">✅ No overdue action items! You are caught up.</div>
                                )}

                                {/* Stale Accounts */}
                                {data.staleAccounts?.length > 0 ? (
                                  <div>
                                    <div className="font-semibold text-xs text-orange-600 uppercase tracking-wider mt-2">Stale Accounts (No activity in 14+ days)</div>
                                    <ul className="mt-1 space-y-1">
                                      {data.staleAccounts.map((acc: any, idx: number) => (
                                        <li key={idx} className="text-gray-800">
                                          {acc.name} <span className="text-gray-500 text-xs">({acc.stage} - Last active: {acc.last_activity_at ? acc.last_activity_at.substring(0, 10) : 'Never'})</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : (
                                  <div className="text-green-700 italic">✅ No stale accounts! All pipeline is active.</div>
                                )}
                              </div>
                            );
                          }

                          // ==========================================
                          // RENDER DRAFT COMMUNICATION (WITH COPY BUTTON)
                          // ==========================================
                          if (toolName === 'draftCommunication') {
                            if (data.found === false) {
                              return <div key={i} className="text-red-500 text-sm mt-1">{data.message}</div>;
                            }
                            if (data.draftText) {
                              return (
                                <div key={i} className="mt-2 bg-white border border-gray-200 p-4 rounded shadow-sm relative group">
                                  <div className="font-bold text-[#091C2B] text-base mb-2">
                                    📝 Draft {data.channel ? data.channel.charAt(0).toUpperCase() + data.channel.slice(1) : ''} to {data.contact?.name} at {data.account?.name}
                                  </div>
                                  <button 
                                    onClick={() => navigator.clipboard.writeText(data.draftText)}
                                    className="absolute top-2 right-2 bg-[#091C2B] text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition"
                                  >
                                    📋 Copy
                                  </button>
                                  <div className="whitespace-pre-wrap text-sm text-gray-800 bg-gray-50 p-3 rounded border border-gray-100">{data.draftText}</div>
                                </div>
                              );
                            }
                            return null;
                          }

                          // ==========================================
                          // RENDER PROPOSE ACTION (Confirmation Card)
                          // ==========================================
                          if (toolName === 'proposeAction') {
                            return (
                              <div key={i} className="mt-2 bg-yellow-50 border border-yellow-200 p-4 rounded shadow-sm space-y-3">
                                <div className="font-bold text-yellow-800 text-base">⚠️ Confirm Action</div>
                                <div className="text-sm text-gray-800">{data.confirmationMessage}</div>
                                <div className="flex gap-2">
                                  <button 
                                    onClick={() => {
                                      // Trigger the executeAction tool by sending a specific message
                                      sendMessage({ text: `Confirmed: Execute ${data.actionType} on ${data.targetAccount} with value ${data.newValue}` });
                                    }}
                                    className="bg-green-600 text-white text-sm px-3 py-1 rounded hover:bg-green-700"
                                  >
                                    ✅ Confirm
                                  </button>
                                  <button 
                                    onClick={() => sendMessage({ text: "Cancelled" })}
                                    className="bg-red-500 text-white text-sm px-3 py-1 rounded hover:bg-red-600"
                                  >
                                    ❌ Cancel
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          // ==========================================
                          // RENDER EXECUTE ACTION (Success Card)
                          // ==========================================
                          if (toolName === 'executeAction') {
                            if (data.success) {
                              return (
                                <div key={i} className="mt-2 bg-green-50 border border-green-200 p-3 rounded text-sm flex items-start gap-2">
                                  <span className="text-lg">✅</span>
                                  <div>{data.message}</div>
                                </div>
                              );
                            } else {
                              return <div key={i} className="text-red-500 text-sm mt-1 bg-red-50 p-2 rounded border border-red-200">Error: {data.message}</div>;
                            }
                          }

                          // ==========================================
                          // RENDER TEAM PLATE (PURPLE CARD)
                          // ==========================================
                          if (toolName === 'getTeamPlate') {
                            return (
                              <div key={i} className="mt-4 border-l-4 border-purple-500 bg-purple-50 p-4 rounded-r-lg shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                  <h3 className="font-bold text-purple-900 text-lg">
                                    {data.teamMember}&apos;s Plate
                                  </h3>
                                  <span className="bg-purple-200 text-purple-800 text-xs font-bold px-2 py-1 rounded-full">
                                    {data.tasks?.length || 0} Open Tasks
                                  </span>
                                </div>
                                
                                <div className="space-y-2">
                                  {data.tasks?.map((task: any, idx: number) => (
                                    <div key={idx} className="bg-white p-3 rounded border border-purple-100 flex items-start justify-between">
                                      <div>
                                        <p className="font-medium text-gray-800">{task.description}</p>
                                        <p className="text-xs text-gray-500 mt-1">
                                          Company: {task.accounts?.name || 'N/A'}
                                        </p>
                                      </div>
                                      <div className="text-right ml-4">
                                        <span className={`text-xs font-bold px-2 py-1 rounded ${
                                          task.priority === 'P1' ? 'bg-red-100 text-red-700' :
                                          task.priority === 'P2' ? 'bg-yellow-100 text-yellow-700' :
                                          'bg-blue-100 text-blue-700'
                                        }`}>
                                          {task.priority}
                                        </span>
                                        {task.due_date && (
                                          <p className="text-xs text-gray-500 mt-1">
                                            Due: {new Date(task.due_date).toLocaleDateString()}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                  {data.tasks?.length === 0 && (
                                    <p className="text-sm text-purple-700 italic">No open tasks. All caught up! 🚀</p>
                                  )}
                                </div>
                              </div>
                            );
                          }

                          // ==========================================
                          // RENDER READ DATA (Account Info)
                          // ==========================================
                          // Safety check to prevent crash if data.account is missing
                          if (toolName === 'getAccountInfo') {
                            if (data.found === false) {
                              return <div key={i} className="text-red-500 text-sm mt-1">{data.message}</div>;
                            }
                            if (!data.account) {
                              return <div key={i} className="text-red-500 text-sm mt-1">Error: Account data missing.</div>;
                            }

                            // Find the user message that immediately precedes THIS AI message
                            let triggeringUserText = '';
                            if (messageIndex > 0 && messages[messageIndex - 1].role === 'user') {
                              triggeringUserText = messages[messageIndex - 1].parts
                                ?.map((p: any) => p.text)
                                .join(' ')
                                .toLowerCase() || '';
                            }

                            let uiFocus = toolPart.input?.focus || 'full'; 

                            if (triggeringUserText.includes('action item') || triggeringUserText.includes('task') || triggeringUserText.includes('todo') || triggeringUserText.includes('follow up')) {
                              uiFocus = 'action_items';
                            } else if (triggeringUserText.includes('contact') || triggeringUserText.includes('person') || triggeringUserText.includes('who')) {
                              uiFocus = 'contacts';
                            } else if (triggeringUserText.includes('interaction') || triggeringUserText.includes('meeting') || triggeringUserText.includes('history')) {
                              uiFocus = 'interactions';
                            }

                            return (
                              <div key={i} className="mt-2 text-sm space-y-3 bg-gray-50 p-3 rounded border border-gray-100">
                                <div className="font-bold text-[#091C2B] text-base">
                                  {data.account.name} 
                                  <span className="font-normal text-gray-500 text-xs ml-2">
                                    {data.account.type} | {data.account.stage} | {data.account.city}
                                  </span>
                                </div>
                                
                                {(uiFocus === 'full' || uiFocus === 'contacts') && data.contacts?.length > 0 && (
                                  <div>
                                    <div className="font-semibold text-xs text-gray-600 uppercase tracking-wider">Contacts</div>
                                    <ul className="mt-1 space-y-1">
                                      {data.contacts.map((c: any, idx: number) => (
                                        <li key={idx} className="text-gray-800">
                                          {c.name} {c.title && <span className="text-gray-500 text-xs">({c.title})</span>}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {(uiFocus === 'contacts' && (!data.contacts || data.contacts.length === 0)) && (
                                   <div className="text-gray-500 italic">No contacts found for {data.account.name}.</div>
                                )}

                                {(uiFocus === 'full' || uiFocus === 'interactions') && data.interactions?.length > 0 && (
                                  <div>
                                    <div className="font-semibold text-xs text-gray-600 uppercase tracking-wider">Recent Interactions</div>
                                    <ul className="mt-1 space-y-1">
                                      {data.interactions.map((int: any, idx: number) => (
                                        <li key={idx} className="text-gray-800">
                                          <span className="text-gray-500 text-xs">({int.date})</span> {int.notes}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {(uiFocus === 'interactions' && (!data.interactions || data.interactions.length === 0)) && (
                                   <div className="text-gray-500 italic">No recent interactions found for {data.account.name}.</div>
                                )}

                                {(uiFocus === 'full' || uiFocus === 'action_items') && data.actionItems?.length > 0 && (
                                  <div>
                                    <div className="font-semibold text-xs text-gray-600 uppercase tracking-wider">Action Items</div>
                                    <ul className="mt-1 space-y-1">
                                      {data.actionItems.map((a: any, idx: number) => (
                                        <li key={idx} className="text-gray-800">
                                          {a.priority} {a.description} <span className="text-gray-500 text-xs">(Status: {a.status}, Due: {a.due_date})</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {(uiFocus === 'action_items' && (!data.actionItems || data.actionItems.length === 0)) && (
                                   <div className="text-gray-500 italic">No pending action items for {data.account.name}.</div>
                                )}
                              </div>
                            );
                          }
                          
                          // Fallback for unknown tools
                          return null;
                        }
                      }
                      
                      return null;
                    })}
                  </div>
                </div>
              </div>
              );
            })}
            {isLoading && messages.at(-1)?.role === 'user' && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 bg-gray-100 p-4 rounded-2xl rounded-tl-none border border-gray-200 shadow-sm">
                  <div className="flex items-end gap-1 h-8">
                    <div className="w-2 h-2 bg-[#F97316] rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-2 h-2 bg-[#3B82F6] rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-2 h-2 bg-[#22C55E] rounded-full animate-bounce"></div>
                  </div>
                  <span className="text-gray-600 text-sm font-medium ml-2">Bridgi AI is thinking...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Box */}
      <form onSubmit={onSubmit} className="flex gap-2">
        <input 
          value={input} 
          onChange={(e) => setInput(e.target.value)} 
          placeholder="Type your message..." 
          className="flex-grow border p-3 rounded-lg outline-none focus:border-[#D26A3E]"
        />
        <button 
          type="submit" 
          className="bg-[#D26A3E] text-white p-3 rounded-lg hover:bg-[#091C2B] transition font-semibold"
          disabled={isLoading}
        >
          Send
        </button>
      </form>
    </main>
  );
}