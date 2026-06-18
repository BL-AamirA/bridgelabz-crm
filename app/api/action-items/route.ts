import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

// GET ALL ACTION ITEMS FOR AN ACCOUNT
export async function GET(request: Request) {
  const supabase = createClient();
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('account_id');

  if (!accountId) {
    return NextResponse.json({ error: "Account ID is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("action_items")
    .select("*")
    .eq("account_id", accountId)
    .order("due_date", { ascending: true }); // Show urgent ones first

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// CREATE A NEW ACTION ITEM
export async function POST(request: Request) {
  const supabase = createClient();
  const body = await request.json();
  
  const { data, error } = await supabase
    .from("action_items")
    .insert([body])
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data[0]);
}