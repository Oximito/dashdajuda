import { createClient, SupabaseClient } from "@supabase/supabase-js";

// As variáveis de ambiente devem ser prefixadas com VITE_ para serem acessíveis no cliente com Vite
const supabaseUrl: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Supabase URL or Anon Key is missing. Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your .env file and configured in your deployment environment.");
  // Em um app real, você poderia lançar um erro ou ter um estado de erro mais robusto na UI
  // Para este exemplo, vamos permitir que createClient lide com undefined, o que resultará em erro no runtime se não configurado.
}

// Exportar o cliente Supabase tipado
export const supabase: SupabaseClient = createClient(supabaseUrl!, supabaseAnonKey!); // Usamos '!' para afirmar que não serão undefined neste ponto, após a verificação.
                                                                                  // Idealmente, haveria um tratamento de erro mais gracioso se eles fossem undefined.

