"use client";

import { useChat } from '@ai-sdk/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BridgiLogo } from "@/components/BridgiLogo";

// // Custom Logo matching the BridgeLabz colorful abstract theme
// function BridgiLogo({ size = 32 }: { size?: number }) {
//   return (
//     <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
//       <circle cx="20" cy="20" r="20" fill="#F3F4F6" />
//       <circle cx="20" cy="14" r="5" fill="#D26A3E" />
//          <path d="M9 34C9 27.268 13.925 22 20 22C26.075 22 31 27.268 31 34" fill="none" stroke="#1D4ED8" strokeWidth="3" strokeLinecap="round" />
//       <path d="M20 25.5C15 25.5 12 28 12 35H20V25.5Z" fill="#EAB308" />
//       <path d="M20 25.5C25 25.5 28 28 28 35H20V25.5Z" fill="#16A34A" />

//     </svg>
//   );
// }

export default function Chat() {
  const router = useRouter();
  // const { messages, sendMessage, status } = useChat({
  //   api: '/api/chat'
  // });
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
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {/* AI Bubble */}
                {m.role !== 'user' && <div className="mr-2 mt-1"><BridgiLogo size={32} /></div>}
                <div className={`max-w-[70%] p-3 rounded-lg shadow-sm ${m.role === 'user' ? 'bg-[#091C2B] text-white' : 'bg-gray-100 text-black border'}`}>
                  <span className="text-xs font-semibold block mb-1 opacity-70">
                    {m.role === 'user' ? 'Narayan' : 'Bridgi AI'}
                  </span>
                  <div className="whitespace-pre-wrap">
                    {m.parts.map((part, i) => {
                      if (part.type === 'text') {
                        return <div key={i}>{part.text}</div>;
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
                  {/* Three bouncing figures like your logo */}
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