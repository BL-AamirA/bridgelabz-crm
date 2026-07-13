import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateEmbedding(text: string): Promise<number[] | null> {
  // Don't try to embed empty text
  if (!text || text.trim().length === 0) return null;
  
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small', // Fast, cheap, high quality
      input: text.replace(/\n/g, ' '), // Clean up newlines
    });
    
    return response.data[0].embedding;
  } catch (error) {
    console.error("[Embedding Error]", error);
    return null; // Fail gracefully so the app doesn't crash
  }
}