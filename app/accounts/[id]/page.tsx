"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter, useParams } from "next/navigation";

type Account = any;
type Contact = any;
type Interaction = any;
type ActionItem = any;

export default function AccountDetail() {
  const [account, setAccount] = useState<Account | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const router = useRouter();
  const params = useParams();

  // Contact Form State
  const [contactName, setContactName] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactLinkedin, setContactLinkedin] = useState("");

  // Interaction Form State
  const [interactionType, setInteractionType] = useState("meeting");
  const [interactionNotes, setInteractionNotes] = useState("");

  // Action Item Form State
  const [actionDescription, setActionDescription] = useState("");
  const [actionPriority, setActionPriority] = useState("P2");
  const [actionDueDate, setActionDueDate] = useState("");

  const accountId = params.id;

  useEffect(() => {
    if (accountId) {
      fetchAccountData();
    }
  }, [accountId]);

  const fetchAccountData = async () => {
    const supabase = createClient();
    
    const { data: accountData } = await supabase.from("accounts").select("*").eq("id", accountId).single();
    if (accountData) setAccount(accountData);

    const { data: contactsData } = await supabase.from("contacts").select("*").eq("account_id", accountId);
    if (contactsData) setContacts(contactsData);

    const { data: interactionsData } = await supabase.from("interactions").select("*").eq("account_id", accountId).order("date", { ascending: false });
    if (interactionsData) setInteractions(interactionsData);

    const { data: actionData } = await supabase.from("action_items").select("*").eq("account_id", accountId).order("due_date", { ascending: true });
    if (actionData) setActionItems(actionData);
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    const { error } = await supabase.from("contacts").insert([
      { account_id: accountId, name: contactName, title: contactTitle, email: contactEmail, phone: contactPhone, linkedin_url: contactLinkedin },
    ]);
    if (error) { alert("Error saving contact: " + error.message); return; }
    setContactName(""); setContactTitle(""); setContactEmail(""); setContactPhone(""); setContactLinkedin("");
    fetchAccountData();
  };

  const handleAddInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    const { error } = await supabase.from("interactions").insert([
      { account_id: accountId, type: interactionType, notes: interactionNotes },
    ]);
    if (error) { alert("Error saving interaction: " + error.message); return; }
    setInteractionType("meeting"); setInteractionNotes("");
    fetchAccountData();
  };

  const handleAddActionItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    const { error } = await supabase.from("action_items").insert([
      { 
        account_id: accountId, 
        description: actionDescription, 
        priority: actionPriority, 
        due_date: actionDueDate || null 
      },
    ]);
    if (error) { alert("Error saving action item: " + error.message); return; }
    setActionDescription(""); setActionPriority("P2"); setActionDueDate("");
    fetchAccountData();
  };

  if (!account) return <div className="p-10">Loading...</div>;

  return (
    <main className="min-h-screen p-10 bg-gray-50">
      <button onClick={() => router.push("/")} className="text-[#D26A3E] hover:underline mb-6 inline-block">
        ← Back to Pipeline
      </button>

      {/* Account Header */}
      <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 mb-8">
        <h1 className="text-3xl font-bold text-[#091C2B]">{account.name}</h1>
        <div className="flex gap-4 mt-2 text-gray-600">
          <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">{account.type}</span>
          <span className="bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded ml-2">{account.stage}</span>
          <span>📍 {account.city || "No City"}</span>
        </div>
      </div>

      {/* CONTACTS SECTION */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 h-fit">
          <h2 className="text-xl font-semibold mb-4 text-[#D26A3E]">Add New Contact</h2>
          <form onSubmit={handleAddContact} className="flex flex-col gap-3">
            <input type="text" placeholder="Full Name *" value={contactName} onChange={(e) => setContactName(e.target.value)} className="border p-2 rounded" required />
            <input type="text" placeholder="Title (e.g. Director)" value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} className="border p-2 rounded" />
            <input type="email" placeholder="Email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="border p-2 rounded" />
            <input type="text" placeholder="Phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="border p-2 rounded" />
            <input type="url" placeholder="LinkedIn URL" value={contactLinkedin} onChange={(e) => setContactLinkedin(e.target.value)} className="border p-2 rounded" />
            <button type="submit" className="bg-[#091C2B] text-white p-2 rounded hover:bg-[#D26A3E] transition mt-2">Save Contact</button>
          </form>
        </div>
        <div className="col-span-2 bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold mb-4 text-[#091C2B]">Contacts</h2>
          {contacts.length === 0 ? <p className="text-gray-500">No contacts added yet.</p> : (
            <div className="flex flex-col gap-4">
              {contacts.map((contact) => (
                <div key={contact.id} className="border p-4 rounded shadow-sm flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-[#091C2B]">{contact.name}</h3>
                    <p className="text-sm text-gray-500">{contact.title || "No title"}</p>
                    <div className="mt-2 text-sm text-gray-600 flex flex-col gap-1">
                      {contact.email && <span>✉️ {contact.email}</span>}
                      {contact.phone && <span>📱 {contact.phone}</span>}
                    </div>
                  </div>
                  {contact.linkedin_url && <a href={contact.linkedin_url} target="_blank" className="text-blue-500 hover:underline text-sm">🔗 LinkedIn</a>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* INTERACTIONS SECTION */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 h-fit">
          <h2 className="text-xl font-semibold mb-4 text-[#D26A3E]">Log Interaction</h2>
          <form onSubmit={handleAddInteraction} className="flex flex-col gap-3">
            <select value={interactionType} onChange={(e) => setInteractionType(e.target.value)} className="border p-2 rounded">
              <option value="meeting">Meeting</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="linkedin">LinkedIn</option>
            </select>
            <textarea placeholder="Meeting notes or summary..." value={interactionNotes} onChange={(e) => setInteractionNotes(e.target.value)} className="border p-2 rounded h-32" required />
            <button type="submit" className="bg-[#091C2B] text-white p-2 rounded hover:bg-[#D26A3E] transition mt-2">Save Interaction</button>
          </form>
        </div>
        <div className="col-span-2 bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold mb-4 text-[#091C2B]">Interaction History</h2>
          {interactions.length === 0 ? <p className="text-gray-500">No interactions logged yet.</p> : (
            <div className="flex flex-col gap-4">
              {interactions.map((interaction) => (
                <div key={interaction.id} className="border-l-4 border-[#D26A3E] p-4 bg-gray-50 rounded-r shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-[#091C2B] capitalize">{interaction.type}</span>
                    <span className="text-xs text-gray-500">{interaction.date}</span>
                  </div>
                  <p className="text-gray-700 text-sm whitespace-pre-wrap">{interaction.notes}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ACTION ITEMS SECTION */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 h-fit">
          <h2 className="text-xl font-semibold mb-4 text-[#D26A3E]">Add Action Item</h2>
          <form onSubmit={handleAddActionItem} className="flex flex-col gap-3">
            <textarea 
              placeholder="Describe the task (e.g. Send proposal)..." 
              value={actionDescription} 
              onChange={(e) => setActionDescription(e.target.value)} 
              className="border p-2 rounded h-24" 
              required 
            />
            <select value={actionPriority} onChange={(e) => setActionPriority(e.target.value)} className="border p-2 rounded">
              <option value="P1">P1 (Urgent)</option>
              <option value="P2">P2 (Next Week)</option>
              <option value="P3">P3 (Delegate)</option>
            </select>
            <input 
              type="date" 
              value={actionDueDate} 
              onChange={(e) => setActionDueDate(e.target.value)} 
              className="border p-2 rounded" 
            />
            <button type="submit" className="bg-[#091C2B] text-white p-2 rounded hover:bg-[#D26A3E] transition mt-2">
              Create Task
            </button>
          </form>
        </div>
        <div className="col-span-2 bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold mb-4 text-[#091C2B]">Action Items / To-Dos</h2>
          {actionItems.length === 0 ? <p className="text-gray-500">No action items yet.</p> : (
            <div className="flex flex-col gap-4">
              {actionItems.map((item) => (
                <div key={item.id} className={`border p-4 rounded shadow-sm flex justify-between items-center ${item.status === 'done' ? 'bg-green-50 opacity-60' : 'bg-gray-50'}`}>
                  <div>
                    <p className="text-[#091C2B] font-medium">{item.description}</p>
                    {item.due_date && <p className="text-xs text-gray-500 mt-1">Due: {item.due_date}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded font-bold ${
                      item.priority === 'P1' ? 'bg-red-100 text-red-700' : 
                      item.priority === 'P2' ? 'bg-yellow-100 text-yellow-700' : 
                      'bg-blue-100 text-blue-700'
                    }`}>{item.priority}</span>
                    <span className={`text-xs px-2 py-1 rounded ${item.status === 'open' ? 'bg-gray-200 text-gray-800' : 'bg-green-200 text-green-800'}`}>
                      {item.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </main>
  );
}