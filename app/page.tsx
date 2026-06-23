"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { BridgiLogo } from "@/components/BridgiLogo";

type Account = {
  id: string;
  name: string;
  type: string | null;
  stage: string | null;
  city: string | null;
  spoc_id: string | null;
};

type User = {
  id: string;
  name: string;
};

export default function Home() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [users, setUsers] = useState<User[]>([]); // To populate SPOC filter
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("");
  
  // Form State
  const [name, setName] = useState("");
  const [type, setType] = useState("GCC");
  const [city, setCity] = useState("");
  
  // Filter State
  const [filterStage, setFilterStage] = useState("All");
  const [filterCity, setFilterCity] = useState("");
  const [filterType, setFilterType] = useState("All");
  const [filterSpoc, setFilterSpoc] = useState("All");
  
  const router = useRouter();

  const fetchData = async () => {
    const supabase = createClient();
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push("/login");
      return;
    }

    const { data: userData } = await supabase
      .from("users")
      .select("name, role")
      .eq("id", session.user.id)
      .single();

    if (userData) {
      setUserName(userData.name);
      setUserRole(userData.role);
    }

    // Fetch all users so CEO can filter by SPOC
    const { data: usersData } = await supabase.from("users").select("id, name");
    if (usersData) setUsers(usersData);

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
    await supabase.from("accounts").insert([{ name, type, city, stage: "Cold" }]);
    setName("");
    setCity("");
    fetchData();
  };

  // Filter logic: match all 4 filters
  const filteredAccounts = accounts.filter((acc) => {
    const matchesStage = filterStage === "All" || acc.stage === filterStage;
    const matchesCity = filterCity === "" || (acc.city && acc.city.toLowerCase().includes(filterCity.toLowerCase()));
    const matchesType = filterType === "All" || acc.type === filterType;
    const matchesSpoc = filterSpoc === "All" || acc.spoc_id === filterSpoc;
    return matchesStage && matchesCity && matchesType && matchesSpoc;
  });

  return (
    <main className="min-h-screen p-10 bg-gray-50">
      <div className="flex justify-between items-center mb-8">
      <div className="flex items-center gap-6">
        <h1 className="text-3xl font-bold text-[#091C2B]">BridgeLabz CRM</h1>
        <button 
          onClick={() => router.push('/chat')} 
          className="bg-[#D26A3E] text-white px-4 py-2 rounded text-sm font-semibold hover:bg-[#091C2B] transition flex items-center gap-2"
        >
          <BridgiLogo size={25} /> 
          Ask Bridgi AI
        </button>
      </div>
      <div className="flex items-center gap-4">
          <span className="text-gray-600">Welcome, {userName} ({userRole})</span>
          <button onClick={handleLogout} className="text-red-500 hover:underline text-sm">Log Out</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* LEFT COLUMN: Add Account Form - ONLY SHOW FOR CEO */}
        {userRole === "CEO" && (
          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200 h-fit">
            <h2 className="text-xl font-semibold mb-4 text-[#D26A3E]">Add New Account</h2>
            <form onSubmit={handleAddAccount} className="flex flex-col gap-4">
              <input type="text" placeholder="Company Name (e.g. Kyndryl)" value={name} onChange={(e) => setName(e.target.value)} className="border p-2 rounded" required />
              <select value={type} onChange={(e) => setType(e.target.value)} className="border p-2 rounded">
                <option value="GCC">GCC</option>
                <option value="SI">SI</option>
                <option value="Academic">Academic</option>
                <option value="Investor">Investor</option>
              </select>
              <input type="text" placeholder="City (e.g. Bangalore)" value={city} onChange={(e) => setCity(e.target.value)} className="border p-2 rounded" />
              <button type="submit" className="bg-[#091C2B] text-white p-2 rounded hover:bg-[#D26A3E] transition">Add Account</button>
            </form>
          </div>
        )}

        {/* RIGHT COLUMN: Account List with Filters */}
        <div className={userRole === "CEO" ? "col-span-2" : "col-span-3"}>
          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
            
            {/* FILTER BAR - 4 FILTERS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 pb-4 border-b">
              <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className="border p-2 rounded">
                <option value="All">All Stages</option>
                <option value="Cold">Cold</option>
                <option value="Warm">Warm</option>
                <option value="Hot">Hot</option>
                <option value="Closed Won">Closed Won</option>
                <option value="Closed Lost">Closed Lost</option>
                <option value="On Hold">On Hold</option>
              </select>
              <input type="text" placeholder="Filter by City..." value={filterCity} onChange={(e) => setFilterCity(e.target.value)} className="border p-2 rounded" />
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="border p-2 rounded">
                <option value="All">All Types</option>
                <option value="GCC">GCC</option>
                <option value="SI">SI</option>
                <option value="Academic">Academic</option>
                <option value="Investor">Investor</option>
                <option value="Product">Product</option>
              </select>
              <select value={filterSpoc} onChange={(e) => setFilterSpoc(e.target.value)} className="border p-2 rounded">
                <option value="All">All SPOCs</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <h2 className="text-xl font-semibold mb-4 text-[#091C2B]">Pipeline Accounts</h2>
            {filteredAccounts.length === 0 ? (
              <p className="text-gray-500">No accounts match your filters.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredAccounts.map((acc) => (
                  <div key={acc.id} className="border p-4 rounded flex justify-between items-center cursor-pointer hover:bg-gray-50 transition" onClick={() => router.push(`/accounts/${acc.id}`)}>
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

      </div>
    </main>
  );
}