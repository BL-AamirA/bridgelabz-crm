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
            {messages.map((m, messageIndex) => (
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
                          const toolName = part.type; 

                          // ==========================================
                          // RENDER WRITE CONFIRMATION (Meeting Notes)
                          // ==========================================
                          if (toolName === 'tool-captureMeetingNotes') {
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
                          // RENDER READ DATA (Account Info)
                          // ==========================================
                          
                          // FIX: Find the user message that immediately precedes THIS AI message
                          // This prevents old cards from mutating when a new question is asked!
                          let triggeringUserText = '';
                          if (messageIndex > 0 && messages[messageIndex - 1].role === 'user') {
                            triggeringUserText = messages[messageIndex - 1].parts
                              ?.map((p: any) => p.text)
                              .join(' ')
                              .toLowerCase() || '';
                          }

                          let uiFocus = toolPart.input?.focus || 'full'; 

                          // Override focus based on the specific user question that triggered this card
                          if (triggeringUserText.includes('action item') || triggeringUserText.includes('task') || triggeringUserText.includes('todo') || triggeringUserText.includes('follow up')) {
                            uiFocus = 'action_items';
                          } else if (triggeringUserText.includes('contact') || triggeringUserText.includes('person') || triggeringUserText.includes('who')) {
                            uiFocus = 'contacts';
                          } else if (triggeringUserText.includes('interaction') || triggeringUserText.includes('meeting') || triggeringUserText.includes('history')) {
                            uiFocus = 'interactions';
                          }

                          if (data.found === false) {
                            return <div key={i} className="text-red-500 text-sm mt-1">{data.message}</div>;
                          }

                          return (
                            <div key={i} className="mt-2 text-sm space-y-3 bg-gray-50 p-3 rounded border border-gray-100">
                              <div className="font-bold text-[#091C2B] text-base">
                                {data.account.name} 
                                <span className="font-normal text-gray-500 text-xs ml-2">
                                  {data.account.type} | {data.account.stage} | {data.account.city}
                                </span>
                              </div>
                              
                              {/* Contacts */}
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

                              {/* Interactions */}
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

                              {/* Action Items */}
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
                      }
                      
                      return null;
                    })}
                  </div>
                </div>
              </div>
            ))}
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