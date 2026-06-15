"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Account = {
  id: string;
  name: string;
  type: string | null;
  stage: string | null;
  city: string | null;
};

export default function Home() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [userName, setUserName] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("GCC");
  const [city, setCity] = useState("");
  const router = useRouter();

  // Fetch user data and accounts
  const fetchData = async () => {
    const supabase = createClient();
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push("/login");
      return;
    }

    // Get user's name
    const { data: userData } = await supabase
      .from("users")
      .select("name")
      .eq("id", session.user.id)
      .single();

    if (userData) setUserName(userData.name);

    // Get accounts (RLS automatically applies!)
    const { data: accountData } = await supabase
      .from("accounts")
      .select("*")
      .order("created_at", { ascending: false });

    if (accountData) setAccounts(accountData);
  };

  useEffect(() => {
    fetchData();
  }, [router]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();

    // Insert account directly using Supabase client (respects RLS!)
    await supabase.from("accounts").insert([
      { name, type, city, stage: "Cold" }
    ]);

    // Clear form and refresh list
    setName("");
    setCity("");
    fetchData();
  };

  return (
    <main className="min-h-screen p-10 bg-gray-50">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-[#091C2B]">BridgeLabz CRM</h1>
        <div className="flex items-center gap-4">
          <span className="text-gray-600">Welcome, {userName}</span>
          <button onClick={handleLogout} className="text-red-500 hover:underline text-sm">
            Log Out
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* LEFT COLUMN: Add Account Form */}
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 h-fit">
          <h2 className="text-xl font-semibold mb-4 text-[#D26A3E]">Add New Account</h2>
          <form onSubmit={handleAddAccount} className="flex flex-col gap-4">
            <input
              type="text"
              placeholder="Company Name (e.g. Kyndryl)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border p-2 rounded"
              required
            />
            <select value={type} onChange={(e) => setType(e.target.value)} className="border p-2 rounded">
              <option value="GCC">GCC</option>
              <option value="SI">SI</option>
              <option value="Academic">Academic</option>
              <option value="Investor">Investor</option>
            </select>
            <input
              type="text"
              placeholder="City (e.g. Bangalore)"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="border p-2 rounded"
            />
            <button type="submit" className="bg-[#091C2B] text-white p-2 rounded hover:bg-[#D26A3E] transition">
              Add Account
            </button>
          </form>
        </div>

        {/* RIGHT COLUMN: Account List */}
        <div className="col-span-2 bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold mb-4 text-[#091C2B]">Pipeline Accounts</h2>
          {accounts.length === 0 ? (
            <p className="text-gray-500">No accounts found for your role.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {accounts.map((acc) => (
                <div 
                  key={acc.id} 
                  className="border p-4 rounded flex justify-between items-center cursor-pointer hover:bg-gray-50 transition"
                  onClick={() => router.push(`/accounts/${acc.id}`)}
                >
                  <div>
                    <h3 className="font-bold">{acc.name}</h3>
                    <p className="text-sm text-gray-500">{acc.city || "No city"}</p>
                  </div>
                  <div className="text-right">
                    <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">{acc.type}</span>
                    <span className="bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded ml-2">{acc.stage}</span>
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